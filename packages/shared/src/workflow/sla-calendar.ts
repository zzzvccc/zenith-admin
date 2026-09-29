/**
 * SLA 智能计时算法（纯函数，零项目依赖）。
 * 规范定义与完整实现见《SLA算法.md》；本文件只依赖 Intl.DateTimeFormat 做时区换算，不碰数据库/网络。
 */

export interface WorkCalendarHours { start: string; end: string }
export interface WorkCalendarHoliday { date: string; isWorkday: boolean; specialHours?: WorkCalendarHours[] | null }
export interface WorkCalendarLike {
  timezone: string;                 // IANA 时区，如 'Asia/Shanghai'
  workdays: number[];               // ★0=周日 … 6=周六（JS getUTCDay 编码）——不是 1-7！周六=6、周日=0
  dailyHours: WorkCalendarHours[];  // 每日工作时段，多段=跳午休
  holidays?: WorkCalendarHoliday[]; // ★数组（非 Map）；date='yyyy-MM-dd'（日历时区）
}
const MAX_SCAN_DAYS = 3650; // 日历用尽保护（neat 在此静默降级，我们显式返回 null）

function tzOffsetMs(at: Date, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - at.getTime();
}
function zonedYmd(at: Date, tz: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function zonedDayStartMs(ymd: string, tz: string): number {
  const naive = Date.parse(`${ymd}T00:00:00Z`);
  return naive - tzOffsetMs(new Date(naive), tz);
}
function workRangesOfDay(cal: WorkCalendarLike, ymd: string): Array<[number, number]> {
  const holiday = cal.holidays?.find((h) => h.date === ymd);
  const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  const isWorkday = holiday ? holiday.isWorkday : cal.workdays.includes(weekday);
  if (!isWorkday) return [];
  const base = zonedDayStartMs(ymd, cal.timezone);
  return (holiday?.specialHours ?? cal.dailyHours ?? [])
    .map((h): [number, number] => {
      const [sh, sm] = h.start.split(':').map(Number);
      const [eh, em] = h.end.split(':').map(Number);
      return [base + (sh * 60 + sm) * 60_000, base + (eh * 60 + em) * 60_000];
    })
    .filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
}
/** [start,end] 内落在工作日历中的有效毫秒（等价 neat calculateCostTime 交集求和） */
export function computeWorkTimeBetween(start: Date, end: Date, cal: WorkCalendarLike): number {
  if (end <= start) return 0;
  let total = 0;
  let ymd = zonedYmd(start, cal.timezone);
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const dayStart = zonedDayStartMs(ymd, cal.timezone);
    if (dayStart >= end.getTime()) break;
    for (const [rs, re] of workRangesOfDay(cal, ymd)) {
      total += Math.max(0, Math.min(re, end.getTime()) - Math.max(rs, start.getTime()));
    }
    ymd = zonedYmd(new Date(dayStart + 86_400_000), cal.timezone);
  }
  return total;
}
/** 从 from 起顺延 workMs 个**工作**毫秒（延时/续算的通用原语） */
export function addWorkTime(from: Date, workMs: number, cal: WorkCalendarLike): Date | null {
  if (workMs <= 0) return from;
  let remaining = workMs;
  let ymd = zonedYmd(from, cal.timezone);
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    for (const [rs, re] of workRangesOfDay(cal, ymd)) {
      const s = Math.max(rs, from.getTime());
      if (re <= s) continue;
      const span = re - s;
      if (span >= remaining) return new Date(s + remaining);
      remaining -= span;
    }
    ymd = zonedYmd(new Date(zonedDayStartMs(ymd, cal.timezone) + 86_400_000), cal.timezone);
  }
  return null; // 日历用尽 → 调用方降级墙钟
}
export function toDurationMs(duration: number, unit: 'minutes' | 'hours' | 'days' | 'workdays', cal: WorkCalendarLike): number | null {
  if (unit === 'workdays') {
    const perDay = cal.dailyHours.reduce((sum, h) => {
      const [sh, sm] = h.start.split(':').map(Number);
      const [eh, em] = h.end.split(':').map(Number);
      return sum + (eh * 60 + em - sh * 60 - sm) * 60_000;
    }, 0);
    return perDay > 0 ? duration * perDay : null;
  }
  return duration * ({ minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const)[unit];
}
/** 主入口：算工作日历口径截止时间；返回 null 表示调用方应降级墙钟 */
export function computeWorkCalendarDeadline(
  startAt: Date, duration: number, unit: 'minutes' | 'hours' | 'days' | 'workdays', cal: WorkCalendarLike,
): Date | null {
  const ms = toDurationMs(duration, unit, cal);
  return ms == null ? null : addWorkTime(startAt, ms, cal);
}
