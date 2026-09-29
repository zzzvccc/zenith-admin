# SLA 智能计时算法 · 独立提取版（sla-calendar.ts）

> 从 `SLA开发说明书deep.md` §2.1 完整提取，作为 `SLA开发说明书glm5.4.md` §2.1 的配套实现。
> 分工：**glm5.4 管全部工程接线（schema/service/契约/前端），本文件只管这一个纯函数文件**——直接复制第 3 节代码即可开工。
>
> 提取日期：2026-09-24。若两文档有出入，**以本文件为准**（glm5.4 已按本文件同步对齐）。

---

## 1. 文件位置与依赖

| 项 | 值 |
|---|---|
| 文件 | `packages/shared/src/workflow/sla-calendar.ts`（新建） |
| 测试 | `packages/shared/src/workflow/sla-calendar.test.ts`（新建，见第 6 节） |
| 依赖 | **零项目依赖**——纯函数，只用 `Intl.DateTimeFormat`；不碰数据库/网络 |

## 2. 输入结构 `WorkCalendarLike`（★规范定义，以此为准★）

```ts
export interface WorkCalendarHours { start: string; end: string }        // '09:00' 格式
export interface WorkCalendarHoliday { date: string; isWorkday: boolean; specialHours?: WorkCalendarHours[] | null }
export interface WorkCalendarLike {
  timezone: string;                 // IANA 时区，如 'Asia/Shanghai'
  workdays: number[];               // ★0=周日 … 6=周六（JS getUTCDay 编码）——不是 1-7！
  dailyHours: WorkCalendarHours[];  // 每日工作时段，多段=跳午休
  holidays?: WorkCalendarHoliday[]; // ★数组（非 Map）；date='yyyy-MM-dd'（日历时区）
}
```

**两条铁规（容易踩坑）**：
1. `workdays` 是 **0=周日…6=周六**。默认 `[1,2,3,4,5]`（周一~周五）恰好与"1-7 编码"数值相同，但周六=**6**、周日=**0**——录入界面和 seed 务必用 0-6。
2. `holidays` 是**数组**，算法内部自己 `find(h => h.date === ymd)`；`isWorkday:false`=放假，`isWorkday:true`=补班调休（可带 `specialHours` 覆盖当日时段）。

此结构由 glm5.4 §2.13 的 `loadWorkCalendar` 从 `work_calendars`/`work_calendar_holidays` 表映射而来。

## 3. 完整实现（可直接复制，约 90 行）

```ts
export interface WorkCalendarHours { start: string; end: string }
export interface WorkCalendarHoliday { date: string; isWorkday: boolean; specialHours?: WorkCalendarHours[] | null }
export interface WorkCalendarLike {
  timezone: string;
  workdays: number[];                 // 0=周日..6=周六
  dailyHours: WorkCalendarHours[];
  holidays?: WorkCalendarHoliday[];
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
export function toDurationMs(duration: number, unit: 'minutes'|'hours'|'days'|'workdays', cal: WorkCalendarLike): number | null {
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
  startAt: Date, duration: number, unit: 'minutes'|'hours'|'days'|'workdays', cal: WorkCalendarLike,
): Date | null {
  const ms = toDurationMs(duration, unit, cal);
  return ms == null ? null : addWorkTime(startAt, ms, cal);
}
```

## 4. 四个导出函数速查（谁在哪儿调用）

| 函数 | 干什么 | 调用方（glm5.4 章节） |
|---|---|---|
| `computeWorkCalendarDeadline(startAt, duration, unit, cal)` | 任务激活时算截止时刻（主入口） | §2.6 排期钩子（async-jobs.ts:92）、§2.7 续期分支 |
| `addWorkTime(from, ms, cal)` | 从某时刻起**顺延 N 个工作毫秒** | §2.10 `decideSlaTask`：DELAY（原 deadline 顺延）、RESUME（now+剩余工时） |
| `computeWorkTimeBetween(start, end, cal)` | 区间内净工作毫秒（挂起结算） | §2.10 `decideSlaTask`：SUSPEND（累加已耗工时） |
| `toDurationMs(duration, unit, cal)` | 时长+单位 → 毫秒（workdays 按每日工时折算） | §2.10 RESUME（算总时长→剩余） |

## 5. 行为规则（大白话）

1. **只在工作时段计时**：`dailyHours` 多段就是跳午休；不在任何段内的时间直接跳过。
2. **非工作日跳过**：周末看 `workdays`，节假日看 `holidays`；`isWorkday:false` 整天不算，`isWorkday:true` 是补班（可带 `specialHours` 覆盖时段）。
3. **日历用尽保护**：最多扫 3650 天（10 年），扫不到就返回 `null`——**调用方必须降级墙钟**（glm5.4 §2.6 的 `?? computeTimeoutAt(cfgTimeout)`），绝不静默吞掉。
4. **时区**：一切"哪一天/几点"的判断都以日历的 `timezone` 用 `Intl` 换算（`tzOffsetMs`/`zonedYmd`），禁止手工 ±8h 偏移（夏令时国家会错）。
5. **`workdays` 单位** = duration × 每日总工时（`dailyHours` 各段求和），比如 2 workdays × (3h+4h) = 14 工时小时。
6. **纯函数**：同样的输入永远同样的输出，不改任何外部状态——好测试、好缓存。

## 6. 单测清单（`sla-calendar.test.ts`，来自 deep §8.1）

- [ ] 周末跳过：周五 17:00 + 2 工时 → 下周一 10:00
- [ ] 节假日放假：`holidays` 含 `isWorkday:false` 的周一 → 整天跳过
- [ ] 补班调休：周六 `isWorkday:true` + `specialHours` → 按特殊时段计时
- [ ] 午休多段：`[{09:00-12:00},{13:00-18:00}]`，11:30 + 1h → 13:30
- [ ] `workdays` 单位：2 workdays = 2×每日工时
- [ ] 跨天顺延：工时跨多日正确累计
- [ ] 日历用尽降级：`workdays=[]` 且无 holidays → `addWorkTime` 返 `null`，调用方走墙钟
- [ ] 时区边界：`timezone:'Asia/Shanghai'` 与 UTC 日期不同的时刻（如 UTC 20:00 = 北京次日 04:00）
- [ ] 延时顺延：`addWorkTime(原deadline, 4h, cal)` 不吞已消耗工时（D14）
- [ ] 挂起续算：`computeWorkTimeBetween` 只算区间交集，午休/周末不计入

## 7. 与 glm5.4 的对齐说明

glm5.4 最初版本 §2.1/§2.13 曾写 `holidays: Map<...>` 与 `workdays 1=周一…7=周日`，与 deep 原实现（数组 / 0=周日…6=周六）不一致——**已按本文件同步修正 glm5.4**。开发时以本文件结构为准；`loadWorkCalendar`（glm5.4 §2.13）返回的 `holidays` 必须是**数组**。
