import { and, eq } from 'drizzle-orm';
import type { WorkCalendarLike } from '@zenith/shared/workflow';
import { db } from '../../db';
import { workCalendarHolidays, workCalendars } from '../../db/schema';
import type { DbExecutor } from '../../db/types';

/**
 * 内置兜底日历：数据库无任何启用日历时使用（周一~周五 09:00-12:00 / 13:00-18:00）。
 * 保证智能 SLA 在极端情况下仍能算出截止时刻，而不是直接崩掉。
 */
const FALLBACK_CALENDAR: WorkCalendarLike = {
  timezone: 'Asia/Shanghai',
  workdays: [1, 2, 3, 4, 5],
  dailyHours: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }],
  holidays: [],
};

/** 默认日历：首个启用的日历；无则返回内置兜底 */
export async function getDefaultWorkCalendar(executor: DbExecutor = db): Promise<WorkCalendarLike | null> {
  const [cal] = await executor.select().from(workCalendars)
    .where(eq(workCalendars.status, 'enabled'))
    .orderBy(workCalendars.id)
    .limit(1);
  if (!cal) return FALLBACK_CALENDAR;
  return loadWorkCalendar(cal.id, executor);
}

/**
 * 把 workCalendars / workCalendarHolidays 行映射为算法消费的 WorkCalendarLike。
 *
 * @param calendarId null → 默认日历（兜底）
 * @returns null 表示日历不存在/已禁用 → 调用方必须降级墙钟（见《SLA算法.md》规则 3）
 *
 * 注：本函数按 ID 直取，不额外加租户条件——调用方（节点配置里的 calendarId）来自
 * 租户可见的日历 CRUD 列表，可见性由列表接口的 tenantCondition 保证（§2.13 脚手架）。
 */
export async function loadWorkCalendar(
  calendarId: number | null,
  executor: DbExecutor = db,
): Promise<WorkCalendarLike | null> {
  if (calendarId == null) return getDefaultWorkCalendar(executor);
  const [cal] = await executor.select().from(workCalendars)
    .where(and(eq(workCalendars.id, calendarId), eq(workCalendars.status, 'enabled')))
    .limit(1);
  if (!cal) return null;
  const holidays = await executor.select().from(workCalendarHolidays)
    .where(eq(workCalendarHolidays.calendarId, cal.id));
  return {
    timezone: cal.timezone,
    workdays: cal.workdays,
    dailyHours: cal.dailyHours,
    // ★holidays 为数组结构（《SLA算法.md》规范），非 Map
    holidays: holidays.map((h) => ({
      date: h.date,
      isWorkday: h.isWorkday,
      specialHours: h.specialHours ?? null,
    })),
  };
}
