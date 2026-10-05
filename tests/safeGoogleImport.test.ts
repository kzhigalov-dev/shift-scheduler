import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asManager, resetTestDb, testSql } from './setup';
import { applyImport } from '@/lib/import/applyImport';
import { importDbSnapshot, applyGoogleImport, importPositionConflicts, previewGoogleStaffReview } from '@/lib/import/snapshot';
import { applyScheduleDiff, existingForDiff } from '@/lib/monthPlan/months';
import { diffSchedule } from '@/lib/schedule/diff';
import type { ParsedEvent } from '@/lib/import/parseSheet';
import type { ScheduleEvent } from '@/lib/schedule/parseSchedule';

let id: string; let worker: string; let hall: string; let tickets: string;
const incoming = (): ParsedEvent[] => [{date:'2026-10-06',startTime:'20:00',arriveTime:'18:00',
  concert:'Органный вторник',tag:'organ',baseRate:1300,rawRate:null,comment:'Из таблицы',staff:[{name:'Тестовый работник',position:'БИЛЕТЫ'}]}];
beforeEach(async () => {
  await resetTestDb();
  const [event] = await testSql<{id:string}[]>`insert into event(event_date,start_time,arrive_time,arrive_manual,concert,base_rate,comment,source_title)
    values ('2026-10-06','20:00','17:30',true,'Лики любви',2000,'Ручная заметка','Органный вторник') returning id`;
  id=event.id;
  await testSql`update event set program='Бах',performers='Ансамбль',concert_details_imported=true where id=${id}`;
  const [w]=await testSql<{id:string}[]>`insert into worker(full_name,name_key) values ('Тестовый работник','работник тестовый') returning id`; worker=w.id;
  const positions=await testSql<{id:string;name:string}[]>`select id,name from position`;
  hall=positions.find(p=>p.name==='ЗАЛ')!.id; tickets=positions.find(p=>p.name==='БИЛЕТЫ')!.id;
  await testSql`insert into event_slot(event_id,position_id,quantity,rate,type_rate) values (${id},${hall},2,2100,1700)`;
  await testSql`insert into assignment(worker_id,event_id,position_id,rate) values (${worker},${id},${hall},2200)`;
});
afterAll(()=>testSql.end());

describe('сохранность ручных данных при загрузке из Google', () => {
  it('сохраняет название, приход, вид, комментарий и все ставки существующего мероприятия', async () => {
    const before=(await testSql`select event_type_id from event where id=${id}`)[0].event_type_id;
    const snapshot=await asManager(tx=>importDbSnapshot(tx));
    await asManager(tx=>applyGoogleImport(tx,incoming(),snapshot,false));
    expect((await testSql`select concert,arrive_time::text,base_rate,comment,event_type_id,program,performers from event where id=${id}`)[0])
      .toMatchObject({concert:'Лики любви',arrive_time:'17:30:00',base_rate:2000,comment:'Ручная заметка',event_type_id:before,program:'Бах',performers:'Ансамбль'});
    expect((await testSql`select position_id,rate from assignment where event_id=${id}`)[0]).toMatchObject({position_id:hall,rate:2200});
    expect((await testSql`select quantity,rate,type_rate from event_slot where event_id=${id}`)[0]).toMatchObject({quantity:2,rate:2100,type_rate:1700});
  });
  it('сверка показывает прежнюю и исходную должность до применения', async () => {
    expect(await asManager(tx=>importPositionConflicts(tx,incoming())))
      .toEqual([{date:'2026-10-06',startTime:'20:00',name:'Тестовый работник',current:'ЗАЛ',incoming:'БИЛЕТЫ'}]);
  });
  it('заменяет должность только с явным выбором, сохраняя личную ставку', async () => {
    const snapshot=await asManager(tx=>importDbSnapshot(tx));
    await asManager(tx=>applyGoogleImport(tx,incoming(),snapshot,true));
    expect((await testSql`select position_id,rate from assignment where event_id=${id}`)[0]).toMatchObject({position_id:tickets,rate:2200});
  });
  it('устаревшая сверка должностей не меняет базу', async () => {
    const snapshot=await asManager(tx=>importDbSnapshot(tx));
    await testSql`update assignment set rate=3000 where event_id=${id}`;
    await expect(asManager(tx=>applyGoogleImport(tx,incoming(),snapshot,true))).rejects.toThrow('сверку');
    expect((await testSql`select position_id,rate from assignment where event_id=${id}`)[0]).toMatchObject({position_id:hall,rate:3000});
  });
  it('по-прежнему добавляет новых людей без удаления уже назначенных', async () => {
    const rows=incoming(); rows[0].staff=[{name:'Новый работник',position:null}];
    const snapshot=await asManager(tx=>importDbSnapshot(tx));
    await asManager(tx=>applyGoogleImport(tx,rows,snapshot,false));
    expect((await testSql`select count(*)::int as n from assignment where event_id=${id}`)[0].n).toBe(2);
    expect((await testSql`select position_id from assignment where worker_id=${worker}`)[0].position_id).toBe(hall);
  });
  it('показывает возможный перенос и не создаёт дубликат без отдельного согласия', async () => {
    const rows=incoming(); rows[0].startTime='20:30';
    const snapshot=await asManager(tx=>importDbSnapshot(tx));
    await expect(asManager(tx=>applyGoogleImport(tx,rows,snapshot,false))).rejects.toThrow('перенос');
    expect((await testSql`select count(*)::int as n from event`)[0].n).toBe(1);
    await asManager(tx=>applyGoogleImport(tx,rows,snapshot,false,true));
    expect((await testSql`select count(*)::int as n from event`)[0].n).toBe(2);
  });
  it('сверка листа без года учитывает выбранный год и показывает конфликт должностей', async () => {
    const sheets=[{name:'Октябрь',rows:[['Даты','6.10'],['День недели','вторник'],['Время начала','20:00'],['БИЛЕТЫ','Тестовый работник'],['Концерт','Органный вторник']]}];
    const review=await asManager(tx=>previewGoogleStaffReview(tx,sheets,[{name:'Октябрь',year:2026}]));
    expect(review.positionConflicts).toHaveLength(1);
    expect(review.positionConflicts[0]).toMatchObject({date:'2026-10-06',current:'ЗАЛ',incoming:'БИЛЕТЫ'});
    expect(review.eventCounts['Октябрь']).toBe(1);
  });
  it('добавляет должность новой паре из второго выбранного листа, сохраняя прежних без должности', async () => {
    const rows=incoming(); rows[0].staff=[{name:'Новый работник',position:null}];
    rows.push({...incoming()[0],staff:[{name:'Новый работник',position:'БИЛЕТЫ'},{name:'Тестовый работник',position:'БИЛЕТЫ'}]});
    await testSql`update assignment set position_id=null where worker_id=${worker}`;
    const snapshot=await asManager(tx=>importDbSnapshot(tx));
    await asManager(tx=>applyGoogleImport(tx,rows,snapshot,false));
    const people=await testSql<{full_name:string;position_id:string|null}[]>`select w.full_name,a.position_id from assignment a join worker w on w.id=a.worker_id order by w.full_name`;
    expect(people).toEqual([{full_name:'Новый работник',position_id:tickets},{full_name:'Тестовый работник',position_id:null}]);
  });
  it('старый файловый импорт не затирает подробное название концерта', async () => {
    await asManager(tx=>applyImport(tx,incoming()));
    expect((await testSql`select concert,program,performers from event where id=${id}`)[0])
      .toMatchObject({concert:'Лики любви',program:'Бах',performers:'Ансамбль'});
  });
  it('обновление расписания не затирает подробное название', async () => {
    const row: ScheduleEvent={key:'2026-10-06|20:00',row:3,date:'2026-10-06',startTime:'20:00',title:'Общее название',tag:'organ',arriveTime:'18:00',comment:null,organizer:'арт-зерно',direction:'концерт',checked:true,issue:null};
    await asManager(async tx=>{
      const diff=diffSchedule(await existingForDiff(tx,'2026-10'),[row]);
      await applyScheduleDiff(tx,'2026-10',diff,{add:[],change:[id],remove:[]});
    });
    expect((await testSql`select concert,source_title from event where id=${id}`)[0])
      .toMatchObject({concert:'Лики любви',source_title:'Общее название'});
  });
});
