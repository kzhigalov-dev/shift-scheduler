import { beforeEach, expect, it, vi } from 'vitest';
import { UserError } from '@/lib/errors';
const mocks = vi.hoisted(()=>({auth:vi.fn(),db:vi.fn(),revalidate:vi.fn(),preview:vi.fn(),applyType:vi.fn(),applyEvent:vi.fn(),today:vi.fn()}));
vi.mock('@/lib/auth/session',()=>({requireManager:mocks.auth}));
vi.mock('@/db/client',()=>({withManager:mocks.db}));
vi.mock('@/lib/eventTypes/applyTemplate',()=>({previewTypeApply:mocks.preview,applyTypeTemplate:mocks.applyType,applyEventTemplate:mocks.applyEvent}));
vi.mock('@/lib/month',async importOriginal=>({...await importOriginal<typeof import('@/lib/month')>(),currentDate:mocks.today}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
import { previewApplyTypeAction, applyTypeTemplateAction } from '@/app/(manager)/event-types/actions';
import { applyEventTemplateAction } from '@/app/(manager)/event/[id]/actions';
const TYPE = '00000000-0000-0000-0000-000000000001';
const EVENT = '00000000-0000-0000-0000-000000000002';
const TX = {tx:true};
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(undefined);
  mocks.db.mockImplementation((fn:(tx:unknown)=>unknown)=>fn(TX));
  mocks.today.mockReturnValue('2099-09-15');
});
it('проверяет вход до разбора ID и обращения к базе', async ()=>{
  mocks.auth.mockRejectedValue(new Error('redirect'));
  await expect(previewApplyTypeAction('нет')).rejects.toThrow('redirect');
  await expect(applyTypeTemplateAction('нет')).rejects.toThrow('redirect');
  await expect(applyEventTemplateAction('нет')).rejects.toThrow('redirect');
  expect(mocks.db).not.toHaveBeenCalled();
});
it('отклоняет повреждённый ID без обращения к базе', async ()=>{
  expect(await previewApplyTypeAction('нет')).toEqual({error:'Некорректный вид мероприятия',preview:null});
  expect(await applyTypeTemplateAction('нет')).toEqual({error:'Некорректный вид мероприятия',applied:0});
  expect(await applyEventTemplateAction('нет')).toEqual({error:'Некорректный запрос',applied:0});
  expect(mocks.db).not.toHaveBeenCalled();
});
it('предпросмотр считает «сегодня» по Москве и ничего не обновляет', async ()=>{
  const preview = {typeId:TYPE,typeName:'Двор',events:[],unchanged:2};
  mocks.preview.mockResolvedValue(preview);
  expect(await previewApplyTypeAction(TYPE)).toEqual({error:null,preview});
  expect(mocks.preview).toHaveBeenCalledWith(TX,TYPE,'2099-09-15');
  expect(mocks.revalidate).not.toHaveBeenCalled();
  mocks.preview.mockRejectedValue(new UserError('Вид в архиве'));
  expect(await previewApplyTypeAction(TYPE)).toEqual({error:'Вид в архиве',preview:null});
  mocks.preview.mockRejectedValue(new Error('сырая ошибка базы'));
  vi.spyOn(console,'error').mockImplementation(()=>{});
  expect((await previewApplyTypeAction(TYPE)).error).not.toMatch(/сырая/);
});
it('применение к виду возвращает итог и обновляет месяцы, мероприятия и виды', async ()=>{
  mocks.applyType.mockResolvedValue({applied:2,eventIds:[EVENT,TYPE],months:['2099-09','2099-10']});
  expect(await applyTypeTemplateAction(TYPE)).toEqual({error:null,applied:2});
  expect(mocks.applyType).toHaveBeenCalledWith(TX,TYPE,'2099-09-15');
  expect(mocks.revalidate).toHaveBeenCalledWith('/event/[id]','page');
  for (const path of ['/event-types','/month','/month/2099-09/plan','/month/2099-10/plan']) {
    expect(mocks.revalidate).toHaveBeenCalledWith(path);
  }
  mocks.revalidate.mockClear();
  mocks.applyType.mockRejectedValue(new UserError('Вид в архиве'));
  expect(await applyTypeTemplateAction(TYPE)).toEqual({error:'Вид в архиве',applied:0});
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('одиночное применение обновляет мероприятие, его месяц и виды', async ()=>{
  mocks.applyEvent.mockResolvedValue({applied:1,eventIds:[EVENT],months:['2099-10']});
  expect(await applyEventTemplateAction(EVENT)).toEqual({error:null,applied:1});
  expect(mocks.applyEvent).toHaveBeenCalledWith(TX,EVENT,'2099-09-15');
  for (const path of [`/event/${EVENT}`,'/month','/month/2099-10/plan','/event-types']) expect(mocks.revalidate).toHaveBeenCalledWith(path);
  // Уже выровнял кто-то другой: успех без изменений — UI скажет «уже соответствует».
  mocks.applyEvent.mockResolvedValue({applied:0,eventIds:[],months:[]});
  expect(await applyEventTemplateAction(EVENT)).toEqual({error:null,applied:0});
  mocks.applyEvent.mockRejectedValue(new UserError('Шаблон применяется только к будущим мероприятиям'));
  expect(await applyEventTemplateAction(EVENT)).toEqual({error:'Шаблон применяется только к будущим мероприятиям',applied:0});
});
