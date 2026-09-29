/**
 * SLA 时钟决议状态序列单测（无 DB）。
 * 覆盖《SLA开发说明书glm5.4.md》§修正 D4 / D5 / D6，验证 decideSlaTask 时钟三分支
 * 被抽取到 `applySlaDecision` 后的行为：挂起→恢复→再挂起不双计、延时不清零、日历禁用仍动时钟。
 */
import { describe, expect, it } from 'vitest';
import { addWorkTime, computeWorkTimeBetween, toDurationMs, type WorkCalendarLike } from '@zenith/shared/workflow';
import { applySlaDecision, type SlaTaskClockState } from './sla-clock';

const cal: WorkCalendarLike = {
  timezone: 'Asia/Shanghai',
  workdays: [1, 2, 3, 4, 5], // 周一~周五
  dailyHours: [{ start: '09:00', end: '18:00' }], // 每日 9 个工作小时（无午休段）
  holidays: [],
};

/** 以 Asia/Shanghai 墙钟构造 UTC 瞬间。 */
const at = (iso: string) => new Date(`${iso}+08:00`);

/** 把 applySlaDecision 的输出合并进任务时钟状态，模拟"状态机"逐步推进。 */
function advance(task: SlaTaskClockState, type: 'DELAY' | 'SUSPEND' | 'RESUME', now: Date, requestedMs: number | null = null): SlaTaskClockState {
  const o = applySlaDecision({ type, requestedMs, task, sla: { duration: 1, unit: 'days' }, cal, now });
  return { ...task, ...o.set };
}

const initial = (over: Partial<SlaTaskClockState> = {}): SlaTaskClockState => ({
  slaStatus: 'RUNNING',
  slaStartedAt: at('2026-09-24T09:00:00'), // 周四 09:00 起算
  slaDeadline: addWorkTime(at('2026-09-24T09:00:00'), toDurationMs(1, 'days', cal)!, cal), // 1 工作日的截止
  slaWorkElapsedMs: 0,
  slaSuspendedAt: null,
  ...over,
});

describe('D4：挂起→恢复→再挂起，恢复重置 slaStartedAt，不双计工时', () => {
  const T0 = at('2026-09-24T09:00:00'); // 起算（周四）
  const T1 = at('2026-09-24T18:00:00'); // 周四下班挂起（当日满 9h）
  const T2 = at('2026-09-25T09:00:00'); // 周五 09:00 恢复 → slaStartedAt 重置为 T2
  const T3 = at('2026-09-25T12:00:00'); // 周五 12:00 再挂起（仅计 09-12 = 3h）

  const w01 = computeWorkTimeBetween(T0, T1, cal); // 9h
  const w23 = computeWorkTimeBetween(T2, T3, cal); // 3h
  const w03buggy = computeWorkTimeBetween(T0, T3, cal); // 12h（未重置时再计一遍 → 双计）

  it('首次挂起结算 = W(T0→T1)', () => {
    const after1 = advance(initial({ slaStartedAt: T0 }), 'SUSPEND', T1);
    expect(after1.slaStatus).toBe('SUSPENDED');
    expect(after1.slaSuspendedAt!.getTime()).toBe(T1.getTime());
    expect(after1.slaWorkElapsedMs).toBe(w01);
  });

  it('恢复后 elapsed 不变且 slaStartedAt 重置为 T2', () => {
    const after1 = advance(initial({ slaStartedAt: T0 }), 'SUSPEND', T1);
    const after2 = advance(after1, 'RESUME', T2);
    expect(after2.slaStatus).toBe('RUNNING');
    expect(after2.slaStartedAt!.getTime()).toBe(T2.getTime()); // ★D4 关键：重置
    expect(after2.slaWorkElapsedMs).toBe(w01); // 恢复不改累计
    expect(after2.slaSuspendedAt).toBeNull();
  });

  it('再挂起只计 T2→T3，不下探到 T0（无双计）', () => {
    const after1 = advance(initial({ slaStartedAt: T0 }), 'SUSPEND', T1);
    const after2 = advance(after1, 'RESUME', T2);
    const after3 = advance(after2, 'SUSPEND', T3);
    // 正确累计 = 首日 9h + 次日 3h = 12h
    expect(after3.slaWorkElapsedMs).toBe(w01 + w23);
    // 与"未重置 slaStartedAt"的 buggy 双计结果（9h + 12h = 21h）明显不同
    expect(after3.slaWorkElapsedMs).not.toBe(w01 + w03buggy);
    expect(after3.slaWorkElapsedMs).toBeLessThan(w01 + w03buggy);
  });
});

describe('D5：挂起→延时→恢复，延时只顺延截止、不清零累计工时', () => {
  const T0 = at('2026-09-24T09:00:00');
  const T1 = at('2026-09-24T12:00:00'); // 挂起（计 3h）
  const D0 = addWorkTime(T0, toDurationMs(1, 'days', cal)!, cal)!; // 1 工作日截止
  const delayMs = 2 * 3_600_000; // 延时 2 个工作小时
  const T2 = at('2026-09-24T20:00:00'); // 延时决议时刻（下班后，不影响结算）

  it('DELAY 决议只包含 slaDeadline，绝不写 slaWorkElapsedMs:0', () => {
    const afterSuspend = advance(initial({ slaStartedAt: T0, slaDeadline: D0 }), 'SUSPEND', T1); // elapsed = 3h
    const o = applySlaDecision({ type: 'DELAY', requestedMs: delayMs, task: afterSuspend, sla: { duration: 1, unit: 'days' }, cal, now: T2 });
    // ★D5：set 中不得出现 slaWorkElapsedMs（否则会清零）
    expect(o.set.slaWorkElapsedMs).toBeUndefined();
    expect(o.set.slaStatus).toBeUndefined(); // 延期不改状态（仍 SUSPENDED）
    expect(o.set.slaDeadline).toEqual(addWorkTime(D0, delayMs, cal)); // 顺延
    expect(o.cancelTimeout).toBe(true);
    expect(o.enqueueTimeout).toBe(true);
  });

  it('延时→恢复后累计工时保持（未清零）', () => {
    const elapsedAfterSuspend = computeWorkTimeBetween(T0, T1, cal); // 3h
    let task = advance(initial({ slaStartedAt: T0, slaDeadline: D0 }), 'SUSPEND', T1);
    task = advance(task, 'DELAY', T2, delayMs); // 延时
    task = advance(task, 'RESUME', at('2026-09-25T09:00:00')); // 恢复
    // 累计工时始终是挂起时结算的 3h，未被 DELAY 清零
    expect(task.slaWorkElapsedMs).toBe(elapsedAfterSuspend);
    expect(task.slaStatus).toBe('RUNNING');
    expect(task.slaStartedAt!.getTime()).toBe(at('2026-09-25T09:00:00').getTime());
  });
});

describe('D6：日历禁用（cal=null）后决议仍按墙钟降级动时钟，绝不静默跳过', () => {
  const T0 = at('2026-09-24T09:00:00'); // 周四起算
  const D0 = at('2026-09-30T18:00:00'); // 截止（未来，确保挂起时仍未过期，墙钟剩余为正）
  const T1 = at('2026-09-26T12:00:00'); // 周六中午挂起（跨周末，工作日历下工时为 0）

  it('SUSPEND 无日历时按墙钟全程结算（偏安全侧）', () => {
    const o = applySlaDecision({ type: 'SUSPEND', requestedMs: null, task: initial({ slaStartedAt: T0, slaDeadline: D0 }), sla: { duration: 1, unit: 'days' }, cal: null, now: T1 });
    // 墙钟：T0→T1 含整个周末，远大于工作日历口径
    expect(o.set.slaWorkElapsedMs).toBe(T1.getTime() - T0.getTime());
    expect(o.set.slaStatus).toBe('SUSPENDED');
    expect(o.set.slaSuspendedAt!.getTime()).toBe(T1.getTime());
    expect(o.enqueueTimeout).toBe(false); // 挂起只取消，不入队
  });

  it('RESUME 无日历时按墙钟剩余（截止−挂起时刻）从 now 顺延', () => {
    const T2 = at('2026-09-28T09:00:00'); // 周一 09:00 恢复
    const wallRemaining = D0.getTime() - T1.getTime();
    const o = applySlaDecision({
      type: 'RESUME', requestedMs: null,
      task: { slaStatus: 'SUSPENDED', slaStartedAt: T0, slaDeadline: D0, slaWorkElapsedMs: T1.getTime() - T0.getTime(), slaSuspendedAt: T1 },
      sla: { duration: 1, unit: 'days' }, cal: null, now: T2,
    });
    expect(o.set.slaStatus).toBe('RUNNING');
    expect(o.set.slaStartedAt!.getTime()).toBe(T2.getTime()); // ★D4 重置（墙钟路径同样生效）
    expect(o.set.slaDeadline).toEqual(new Date(T2.getTime() + wallRemaining)); // 墙钟顺延
    expect(o.set.slaSuspendedAt).toBeNull();
    expect(o.enqueueTimeout).toBe(true);
  });

  it('DELAY 无日历时按墙钟顺延截止', () => {
    const delayMs = 3_600_000;
    const o = applySlaDecision({ type: 'DELAY', requestedMs: delayMs, task: initial({ slaStartedAt: T0, slaDeadline: D0 }), sla: { duration: 1, unit: 'days' }, cal: null, now: T1 });
    expect(o.set.slaDeadline).toEqual(new Date(D0.getTime() + delayMs));
    expect(o.enqueueTimeout).toBe(true);
  });

  it('回归：有日历时 RESUME 仍走工作日历口径（未退化为墙钟）', () => {
    const T2 = at('2026-09-25T09:00:00'); // 周五 09:00 恢复
    const task: SlaTaskClockState = {
      slaStatus: 'SUSPENDED', slaStartedAt: T0, slaDeadline: D0,
      slaWorkElapsedMs: computeWorkTimeBetween(T0, at('2026-09-24T12:00:00'), cal), slaSuspendedAt: at('2026-09-24T12:00:00'),
    };
    const o = applySlaDecision({ type: 'RESUME', requestedMs: null, task, sla: { duration: 1, unit: 'days' }, cal, now: T2 });
    const remaining = toDurationMs(1, 'days', cal)! - Number(task.slaWorkElapsedMs);
    expect(o.set.slaDeadline).toEqual(addWorkTime(T2, remaining, cal)); // 工作日历口径，而非墙钟
  });
});
