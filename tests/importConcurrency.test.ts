import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { asManager, resetTestDb, testSql } from './setup';
import { withManager, closePool } from '@/db/client';
import { previewSchedule } from '@/lib/monthPlan/preview';
import { applyScheduleDiff, existingForDiff } from '@/lib/monthPlan/months';
import { diffSchedule } from '@/lib/schedule/diff';
import { checkImportSnapshot, importDbSnapshot } from '@/lib/import/snapshot';
import { applyImport } from '@/lib/import/applyImport';
import { updateWorker } from '@/app/(manager)/workers/operations';
import { nameKey } from '@/lib/import/normalizeName';
import type { ScheduleSheet } from '@/lib/schedule/parseSchedule';

const originalUrl = process.env.DATABASE_URL;
beforeEach(async () => {
  await closePool(); process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  await resetTestDb();
});
afterEach(async () => { await closePool(); process.env.DATABASE_URL = originalUrl; });
afterAll(() => testSql.end());

it('сверка расписания и отпечаток видят одну версию, одновременная правка требует новой сверки', async () => {
  const [event] = await testSql<{id:string}[]>`insert into event(event_date,start_time,concert,source_title)
    values ('2026-10-06','20:00','Концерт','Концерт') returning id`;
  const sheets: ScheduleSheet[] = [{name:'окт 26',month:'2026-10',events:[{key:'2026-10-06|20:30',row:2,date:'2026-10-06',startTime:'20:30',title:'Концерт',tag:'regular',arriveTime:'18:30',comment:null,organizer:'арт-зерно',direction:'концерт',checked:true,issue:null}]}];
  const reviewed=await withManager(async tx=>{
    await tx`set local role app_user`;
    const preview=await previewSchedule(tx,'2026-10',sheets);
    await asManager(other=>other`update event set start_time='21:00' where id=${event.id}`);
    return {preview,snapshot:await importDbSnapshot(tx)};
  },{isolation:'repeatable read'});
  expect(reviewed.preview.sheets[0].diff?.changed[0].before.startTime).toBe('20:00');
  await expect(asManager(async tx=>{
    await checkImportSnapshot(tx,reviewed.snapshot);
    await applyScheduleDiff(tx,'2026-10',diffSchedule(await existingForDiff(tx,'2026-10'),sheets[0].events),{add:[],change:[event.id],remove:[]});
  })).rejects.toThrow('сверку');
  expect((await testSql`select start_time::text as time from event where id=${event.id}`)[0].time).toBe('21:00:00');
});

it('переименование работника ждёт окончания применения, дубликаты не появляются', async () => {
  const [worker]=await testSql<{id:string}[]>`insert into worker(full_name,name_key) values ('Тестовый работник',${nameKey('Тестовый работник')}) returning id`;
  await testSql`insert into event(event_date,start_time,concert) values ('2026-10-06','20:00','Концерт')`;
  const snapshot=await asManager(tx=>importDbSnapshot(tx));
  let rename: Promise<void> | undefined;
  let renamePid = 0;
  const imported = asManager(async tx=>{
    await checkImportSnapshot(tx,snapshot);
    let started!: () => void;
    const ready = new Promise<void>(resolve=>{started=resolve;});
    rename=asManager(async other=>{
      const [backend]=await other<{pid:number}[]>`select pg_backend_pid() as pid`;
      renamePid=backend.pid; started();
      await updateWorker(other,{id:worker.id,fullName:'Новое имя',phone:null});
    });
    await ready;
    // Одно соединение наблюдает реальное ожидание блокировки, вместо угадывания по задержке.
    let locked = false;
    for (let attempt=0;attempt<100;attempt++) {
      const [state]=await testSql<{waiting:boolean}[]>`select wait_event_type='Lock' as waiting from pg_stat_activity where pid=${renamePid}`;
      if (state?.waiting) {locked=true;break;}
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    expect(locked).toBe(true);
    await applyImport(tx,[{date:'2026-10-06',startTime:'20:00',arriveTime:null,concert:'Концерт',tag:'regular',baseRate:null,rawRate:null,comment:null,staff:[{name:'Тестовый работник',position:null}]}],{preserveExisting:true});
  });
  try { await imported; } finally { await rename; }
  expect((await testSql`select count(*)::int as n from worker`)[0].n).toBe(1);
  expect((await testSql`select worker_id from assignment`)[0].worker_id).toBe(worker.id);
});
