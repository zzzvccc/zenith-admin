import * as z from 'zod';
import { auditFieldsSchema, entityStatusSchema, idParam, keywordQuery, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  createWorkCalendarSchema, updateWorkCalendarSchema,
  createWorkCalendarHolidaySchema, updateWorkCalendarHolidaySchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 工作时段（多段 = 跳午休），时间为日历时区下的本地时钟 */
export const workCalendarHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, '格式 HH:mm').meta({ example: '09:00' }),
  end: z.string().regex(/^\d{2}:\d{2}$/, '格式 HH:mm').meta({ example: '18:00' }),
}).meta({ id: 'WorkCalendarHours' });

// 类型名加 Workflow 前缀：与 sla-calendar.ts 的纯算法类型（WorkCalendarHours/WorkCalendarHoliday）区分，避免重导出歧义
export type WorkflowCalendarHours = z.infer<typeof workCalendarHoursSchema>;

/** 工作日历：SLA 只在日历的工作时段内计时 */
export const workCalendarSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '标准工作日' }),
  timezone: z.string().meta({ example: 'Asia/Shanghai', description: 'IANA 时区' }),
  /** 0=周日 … 6=周六（JS getUTCDay 编码），不是 1-7 */
  workdays: z.array(z.int().min(0).max(6)).meta({ description: '0=周日…6=周六' }),
  dailyHours: z.array(workCalendarHoursSchema).meta({ description: '每日工作时段，多段=跳午休' }),
  status: entityStatusSchema,
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkCalendar' });

export type WorkCalendar = z.infer<typeof workCalendarSchema>;

/** 节假日 / 调休：isWorkday=false 放假；true=补班（可带 specialHours 覆盖当日时段） */
export const workCalendarHolidaySchema = z.object({
  id: z.int(),
  calendarId: z.int(),
  date: z.string().meta({ example: '2027-02-06', description: 'yyyy-MM-dd（日历时区）' }),
  isWorkday: z.boolean().meta({ description: 'false=放假；true=补班调休' }),
  specialHours: z.array(workCalendarHoursSchema).nullable(),
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkCalendarHoliday' });

export type WorkflowCalendarHoliday = z.infer<typeof workCalendarHolidaySchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workCalendarListQuery = paginationQuery.extend({
  keyword: keywordQuery('名称'),
});

/** 日历下拉选项（设计器选择 smartSla.calendarId 用） */
export const workCalendarOptionSchema = z.object({
  id: z.int(),
  name: z.string(),
  timezone: z.string(),
}).meta({ id: 'WorkCalendarOption' });

export type WorkCalendarOption = z.infer<typeof workCalendarOptionSchema>;

export const workCalendarContract = defineContract('/api/workflows/calendars', {
  list: op.get('/', { access: { permission: 'workflow:calendar:list' }, query: workCalendarListQuery, response: paginated(workCalendarSchema), summary: '工作日历分页列表' }),
  options: op.get('/options', { access: { permission: ['workflow:calendar:list', 'workflow:definition:list'] }, response: z.array(workCalendarOptionSchema), summary: '工作日历选项（设计器选择用）' }),
  detail: op.get('/{id}', { access: { permission: 'workflow:calendar:list' }, params: idParam, response: workCalendarSchema, summary: '工作日历详情' }),
  create: op.post('/', { access: { permission: 'workflow:calendar:create' }, audit: '创建工作日历', body: createWorkCalendarSchema, response: workCalendarSchema, summary: '创建工作日历' }),
  update: op.put('/{id}', { access: { permission: 'workflow:calendar:update' }, audit: '更新工作日历', params: idParam, body: updateWorkCalendarSchema, response: workCalendarSchema, summary: '更新工作日历' }),
  remove: op.delete('/{id}', { access: { permission: 'workflow:calendar:delete' }, audit: '删除工作日历', params: idParam, summary: '删除工作日历' }),
  // ─── 节假日 / 调休 ───
  holidays: op.get('/{id}/holidays', { access: { permission: 'workflow:calendar:list' }, params: idParam, response: z.array(workCalendarHolidaySchema), summary: '日历的节假日 / 调休列表' }),
  createHoliday: op.post('/{id}/holidays', { access: { permission: 'workflow:calendar:update' }, audit: '新增节假日', params: idParam, body: createWorkCalendarHolidaySchema, response: workCalendarHolidaySchema, summary: '新增节假日 / 调休' }),
  updateHoliday: op.put('/{id}/holidays/{holidayId}', { access: { permission: 'workflow:calendar:update' }, audit: '更新节假日', params: idParam.extend({ holidayId: z.coerce.number().int() }), body: updateWorkCalendarHolidaySchema, response: workCalendarHolidaySchema, summary: '更新节假日 / 调休' }),
  removeHoliday: op.delete('/{id}/holidays/{holidayId}', { access: { permission: 'workflow:calendar:update' }, audit: '删除节假日', params: idParam.extend({ holidayId: z.coerce.number().int() }), summary: '删除节假日 / 调休' }),
}, { auditModule: '工作流管理', tags: ['WorkflowCalendars'] });
