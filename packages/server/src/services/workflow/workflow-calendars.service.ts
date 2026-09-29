import { and, asc, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  workCalendarContract, workCalendarHolidaySchema, workCalendarSchema, workCalendarOptionSchema,
} from '@zenith/shared/workflow';
import { db } from '../../db';
import { workCalendars, workCalendarHolidays } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { keywordCondition } from '../../lib/where-helpers';

export const mapWorkCalendar = entityMapper(workCalendarSchema);
export const mapWorkCalendarHoliday = entityMapper(workCalendarHolidaySchema);

export const workflowCalendarService = defineCrudService(workCalendarContract, {
  table: workCalendars,
  map: mapWorkCalendar,
  notFound: '工作日历不存在',
  unique: '工作日历名称已存在',
  tenant: true,
  list: (q) => ({
    where: [keywordCondition(q.keyword, [workCalendars.name], 'ilike')],
    orderBy: [desc(workCalendars.id)],
  }),
  create: {
    toRow: (input) => ({
      name: input.name,
      timezone: input.timezone,
      // ★0=周日…6=周六（getUTCDay 编码），与 sla-calendar.ts 算法一致
      workdays: input.workdays,
      dailyHours: input.dailyHours,
      status: input.status ?? 'enabled',
    }),
  },
  update: {
    toRow: (input) => ({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.workdays !== undefined ? { workdays: input.workdays } : {}),
      ...(input.dailyHours !== undefined ? { dailyHours: input.dailyHours } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    }),
  },
});

export const {
  list: listWorkflowCalendars,
  get: getWorkflowCalendar,
  create: createWorkflowCalendar,
  update: updateWorkflowCalendar,
  remove: deleteWorkflowCalendar,
} = workflowCalendarService;

// ─── 节假日 / 调休 ────────────────────────────────────────────────────────────

/** 日历选项（设计器选择 smartSla.calendarId 用；只返回启用中的） */
export async function listWorkflowCalendarOptions() {
  const rows = await db.select({
    id: workCalendars.id, name: workCalendars.name, timezone: workCalendars.timezone,
  }).from(workCalendars)
    .where(and(eq(workCalendars.status, 'enabled'), workflowCalendarService.scope()))
    .orderBy(asc(workCalendars.id));
  return rows.map((r) => workCalendarOptionSchema.parse(r));
}

/** 取日历并校验可见性（租户隔离 + 存在性） */
async function requireCalendar(calendarId: number) {
  const [row] = await db.select().from(workCalendars)
    .where(and(eq(workCalendars.id, calendarId), workflowCalendarService.scope()))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '工作日历不存在' });
  return row;
}

/** 节假日列表（按日期升序，便于界面按年浏览） */
export async function listCalendarHolidays(calendarId: number) {
  const [cal] = await db.select().from(workCalendars)
    .where(and(eq(workCalendars.id, calendarId), workflowCalendarService.scope()))
    .limit(1);
  if (!cal) return [];
  const rows = await db.select().from(workCalendarHolidays)
    .where(eq(workCalendarHolidays.calendarId, calendarId))
    .orderBy(asc(workCalendarHolidays.date), asc(workCalendarHolidays.id));
  return rows.map(mapWorkCalendarHoliday);
}

export async function createCalendarHoliday(calendarId: number, input: { date: string; isWorkday: boolean; specialHours?: { start: string; end: string }[] | null }) {
  await requireCalendar(calendarId);
  const [row] = await db.insert(workCalendarHolidays).values({
    calendarId,
    date: input.date,
    isWorkday: input.isWorkday,
    specialHours: input.specialHours ?? null,
    tenantId: (await requireCalendar(calendarId)).tenantId,
  }).returning();
  return mapWorkCalendarHoliday(row);
}

export async function updateCalendarHoliday(calendarId: number, holidayId: number, input: { date?: string; isWorkday?: boolean; specialHours?: { start: string; end: string }[] | null }) {
  await requireCalendar(calendarId);
  const [row] = await db.update(workCalendarHolidays).set({
    ...(input.date !== undefined ? { date: input.date } : {}),
    ...(input.isWorkday !== undefined ? { isWorkday: input.isWorkday } : {}),
    ...(input.specialHours !== undefined ? { specialHours: input.specialHours } : {}),
  }).where(and(eq(workCalendarHolidays.id, holidayId), eq(workCalendarHolidays.calendarId, calendarId)))
    .returning();
  if (!row) throw new HTTPException(404, { message: '节假日不存在' });
  return mapWorkCalendarHoliday(row);
}

export async function deleteCalendarHoliday(calendarId: number, holidayId: number): Promise<void> {
  await requireCalendar(calendarId);
  const deleted = await db.delete(workCalendarHolidays)
    .where(and(eq(workCalendarHolidays.id, holidayId), eq(workCalendarHolidays.calendarId, calendarId)))
    .returning();
  if (deleted.length === 0) throw new HTTPException(404, { message: '节假日不存在' });
}
