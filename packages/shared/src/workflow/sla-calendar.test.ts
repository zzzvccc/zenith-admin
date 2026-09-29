import { describe, expect, it } from 'vitest';
import {
  addWorkTime,
  computeWorkCalendarDeadline,
  computeWorkTimeBetween,
  toDurationMs,
  type WorkCalendarLike,
} from './sla-calendar';

/** 北京墙钟 → UTC 时刻（Asia/Shanghai = UTC+8，无夏令时） */
const cn = (y: number, m: number, d: number, h: number, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 8, min));

/** 周一~周五 09:00-12:00 + 13:00-18:00（每日 8 工时，跳午休） */
const cal = (holidays?: WorkCalendarLike['holidays']): WorkCalendarLike => ({
  timezone: 'Asia/Shanghai',
  workdays: [1, 2, 3, 4, 5],
  dailyHours: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }],
  holidays,
});

describe('sla-calendar', () => {
  it('周末跳过：周五 17:00 + 2 工时 → 下周一 10:00', () => {
    // 2026-09-25 是周五
    const start = cn(2026, 9, 25, 17, 0);
    const got = computeWorkCalendarDeadline(start, 2, 'hours', cal());
    expect(got).toEqual(cn(2026, 9, 28, 10, 0)); // 周一 09:00 起再补 1h
  });

  it('节假日放假：holidays 含 isWorkday:false 的周一 → 整天跳过', () => {
    const start = cn(2026, 9, 25, 17, 0); // 周五 17:00，本可周一 10:00
    const got = computeWorkCalendarDeadline(start, 2, 'hours', cal([
      { date: '2026-09-28', isWorkday: false },
    ]));
    expect(got).toEqual(cn(2026, 9, 29, 10, 0)); // 跳到周二
  });

  it('补班调休：周六 isWorkday:true + specialHours → 按特殊时段计时', () => {
    const start = cn(2026, 9, 25, 17, 0); // 周五
    const got = computeWorkCalendarDeadline(start, 2, 'hours', cal([
      { date: '2026-09-26', isWorkday: true, specialHours: [{ start: '09:00', end: '12:00' }] }, // 周六补班
    ]));
    expect(got).toEqual(cn(2026, 9, 26, 10, 0)); // 周六 09:00+1h
  });

  it('午休多段：11:30 + 1h → 13:30（跳 12:00-13:00）', () => {
    const got = computeWorkCalendarDeadline(cn(2026, 9, 25, 11, 30), 1, 'hours', cal());
    expect(got).toEqual(cn(2026, 9, 25, 13, 30));
  });

  it('workdays 单位：2 workdays = 2×每日工时（8h）= 16 工时小时', () => {
    expect(toDurationMs(2, 'workdays', cal())).toBe(16 * 3_600_000);
  });

  it('跨天顺延：工时跨多日正确累计', () => {
    // 周五 17:00 起 10 工时：周五剩 1h → 周一 8h → 周二 1h → 周二 10:00
    const got = computeWorkCalendarDeadline(cn(2026, 9, 25, 17, 0), 10, 'hours', cal());
    expect(got).toEqual(cn(2026, 9, 29, 10, 0));
  });

  it('日历用尽降级：workdays=[] 且无 holidays → addWorkTime 返 null', () => {
    expect(addWorkTime(cn(2026, 9, 25, 9, 0), 3600_000, { ...cal(), workdays: [] })).toBeNull();
  });

  it('时区边界：UTC 20:00 = 北京次日 04:00，按北京日历判定', () => {
    // UTC 2026-09-24T20:00Z = 北京 2026-09-25 04:00（周五凌晨，未到 09:00）
    const at = new Date('2026-09-24T20:00:00Z');
    const got = addWorkTime(at, 2 * 3_600_000, cal());
    expect(got).toEqual(cn(2026, 9, 25, 11, 0)); // 从 09:00 起 2h
  });

  it('延时顺延：addWorkTime(原deadline, 4h) 不吞已消耗工时', () => {
    const deadline = cn(2026, 9, 25, 17, 0); // 周五 17:00
    // 周五剩 1h(17-18) + 周一 09:00 起 3h = 周一 12:00（正好落在上午段终点）
    expect(addWorkTime(deadline, 4 * 3_600_000, cal())).toEqual(cn(2026, 9, 28, 12, 0));
    // 5h 则跨午休：周五 1h + 周一 09:00-12:00(3h) + 13:00-14:00(1h) = 周一 14:00
    expect(addWorkTime(deadline, 5 * 3_600_000, cal())).toEqual(cn(2026, 9, 28, 14, 0));
  });

  it('挂起续算：computeWorkTimeBetween 只算区间交集，午休/周末不计入', () => {
    // 周五 11:00 → 周一 11:00：周五 1h(11-12) + 周五下午 5h(13-18) + 周一 2h(9-11) = 8h
    expect(computeWorkTimeBetween(cn(2026, 9, 25, 11, 0), cn(2026, 9, 28, 11, 0), cal())).toBe(8 * 3_600_000);
  });

  it('春节：连续多日放假 + 调休补班（除夕~初四放假，初七周六补班）', () => {
    // 2027 春节示意：2-05(五) 除夕放假，2-08~2-12 周一~周五 放假；2-13(六) 补班 09:00-12:00
    const spring = cal([
      { date: '2027-02-05', isWorkday: false },
      { date: '2027-02-08', isWorkday: false },
      { date: '2027-02-09', isWorkday: false },
      { date: '2027-02-10', isWorkday: false },
      { date: '2027-02-11', isWorkday: false },
      { date: '2027-02-12', isWorkday: false },
      { date: '2027-02-13', isWorkday: true, specialHours: [{ start: '09:00', end: '12:00' }] },
    ]);
    // 2-04(四) 17:00 起 2 工时：当天 1h(17-18) → 2-13 补班 09:00 +1h = 10:00
    const got = computeWorkCalendarDeadline(cn(2027, 2, 4, 17, 0), 2, 'hours', spring);
    expect(got).toEqual(cn(2027, 2, 13, 10, 0));
    // 放假期间净工时 = 0
    expect(computeWorkTimeBetween(cn(2027, 2, 8, 9, 0), cn(2027, 2, 12, 18, 0), spring)).toBe(0);
  });

  it('跨年：12-31 → 次年 1-1（元旦放假）→ 1-4 上班', () => {
    const newYear = cal([
      { date: '2027-01-01', isWorkday: false },
    ]);
    // 2026-12-31(四) 17:00 起 2 工时：当天 1h → 1-1 放假 → 1-4(一) 09:00+1h = 10:00
    const got = computeWorkCalendarDeadline(cn(2026, 12, 31, 17, 0), 2, 'hours', newYear);
    expect(got).toEqual(cn(2027, 1, 4, 10, 0));
  });
});
