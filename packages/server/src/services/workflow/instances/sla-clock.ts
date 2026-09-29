/**
 * SLA 时钟决议纯函数（无 DB / 无网络依赖）。
 *
 * 从 `sla-requests.ts` 的 `decideSlaTask` §2.10 时钟三分支（DELAY / SUSPEND / RESUME）
 * 抽取而来，承载 D4 / D5 / D6 修正，便于无 DB 单测（状态序列用例见 `sla-clock.test.ts`）。
 *
 * 设计要点（与《SLA算法.md》规则一致）：
 * - D4：RESUME 重置 `slaStartedAt = now`，否则再挂起会把挂起前工时再计一遍（双计）。
 * - D5：DELAY 只顺延截止时刻，绝不写 `slaWorkElapsedMs = 0`，保护累计不变量。
 * - D6：`cal == null`（日历不可用 / 扫描耗尽）时三分支全部降级墙钟，绝不静默跳过。
 */

import type { WorkflowSmartSlaConfig } from '@zenith/shared/workflow';
import {
  addWorkTime,
  computeWorkTimeBetween,
  toDurationMs,
  type WorkCalendarLike,
} from '@zenith/shared/workflow';

export type SlaRequestKind = 'DELAY' | 'SUSPEND' | 'RESUME';

/** 原处理人任务当前的时钟状态（来自 workflowTasks 的 5 个 SLA 列）。 */
export interface SlaTaskClockState {
  slaStatus: string | null;
  slaStartedAt: Date | null;
  slaDeadline: Date | null;
  slaWorkElapsedMs: number | null;
  slaSuspendedAt: Date | null;
}

/** `decideSlaTask` 应写入 workflowTasks 的列（仅含需要变更者）。 */
export interface SlaDecisionSet {
  slaStatus?: 'RUNNING' | 'SUSPENDED';
  slaStartedAt?: Date | null;
  slaDeadline?: Date | null;
  slaWorkElapsedMs?: number | null;
  slaSuspendedAt?: Date | null;
}

export interface SlaDecisionInput {
  type: SlaRequestKind;
  requestedMs: number | null;
  task: SlaTaskClockState;
  sla: Pick<WorkflowSmartSlaConfig, 'duration' | 'unit'>;
  /** 工作日历；传 null 触发 D6 墙钟降级。 */
  cal: WorkCalendarLike | null;
  /** 决议发生的当前时刻（生产调用方传 `new Date()`，测试可注入固定值）。 */
  now: Date;
}

export interface SlaDecisionOutcome {
  /** 需写入 workflowTasks 的列；为空对象表示本分支不改时钟（如 D6 极端降级无截止）。 */
  set: SlaDecisionSet;
  /** 是否取消已有的 task_timeout 作业（三分支均需：冻结 / 顺延期不再超时）。 */
  cancelTimeout: boolean;
  /** 是否重新入队 task_timeout（仅 DELAY / RESUME 顺延后有新截止）。 */
  enqueueTimeout: boolean;
  /** 重新入队的 runAt；`enqueueTimeout=true` 时必为非 null。 */
  newDeadline: Date | null;
}

/**
 * 按 SLA 决议类型计算原处理人任务的时钟更新。
 * 纯函数：相同输入恒得相同输出，状态推进由调用方按需线程（即"状态序列"测试的基础）。
 */
export function applySlaDecision(input: SlaDecisionInput): SlaDecisionOutcome {
  const { type, requestedMs, task, sla, cal, now } = input;

  // ── DELAY：顺延截止时刻 ──────────────────────────────────────────────
  if (type === 'DELAY' && task.slaDeadline && requestedMs) {
    const reqMs = Number(requestedMs);
    // ★D5：不写 slaWorkElapsedMs:0——累计工时不变量保持。
    // ★D6：日历不可用 / 扫描耗尽 → 降级墙钟顺延。
    const newDeadline =
      (cal ? addWorkTime(new Date(task.slaDeadline), reqMs, cal) : null)
      ?? new Date(new Date(task.slaDeadline).getTime() + reqMs);
    return {
      set: { slaDeadline: newDeadline },
      cancelTimeout: true,
      enqueueTimeout: true,
      newDeadline,
    };
  }

  // ── SUSPEND：结算并冻结 ──────────────────────────────────────────────
  if (type === 'SUSPEND') {
    // ★D6：日历不可用 → 降级全时段墙钟结算（多计非工时 = SLA 更严，偏安全侧），绝不静默跳过。
    const settleMs = cal
      ? (task.slaStartedAt ? computeWorkTimeBetween(new Date(task.slaStartedAt), now, cal) : 0)
      : (task.slaStartedAt ? Math.max(0, now.getTime() - new Date(task.slaStartedAt).getTime()) : 0);
    const elapsed = Number(task.slaWorkElapsedMs ?? 0) + settleMs;
    return {
      set: { slaStatus: 'SUSPENDED', slaSuspendedAt: now, slaWorkElapsedMs: elapsed },
      cancelTimeout: true,
      enqueueTimeout: false,
      newDeadline: null,
    };
  }

  // ── RESUME：恢复并按剩余工时重排截止 ──────────────────────────────────
  // ★D4：重置 slaStartedAt = now——否则再挂起会把挂起前工时再计一遍（双计）。
  // ★D6：日历不可用 → 降级墙钟：剩余 = 挂起时刻的截止差，从 now 顺延。
  const elapsed = Number(task.slaWorkElapsedMs ?? 0);
  const remainingMs = cal ? Math.max(0, (toDurationMs(sla.duration, sla.unit, cal) ?? 0) - elapsed) : null;
  const wallRemainingMs = task.slaDeadline && task.slaSuspendedAt
    ? Math.max(0, new Date(task.slaDeadline).getTime() - new Date(task.slaSuspendedAt).getTime())
    : null;
  const newDeadline =
    (cal && remainingMs != null ? addWorkTime(now, remainingMs, cal) : null)
    ?? (wallRemainingMs != null ? new Date(now.getTime() + wallRemainingMs) : null);
  if (newDeadline) {
    return {
      set: { slaStatus: 'RUNNING', slaStartedAt: now, slaDeadline: newDeadline, slaSuspendedAt: null },
      cancelTimeout: true,
      enqueueTimeout: true,
      newDeadline,
    };
  }
  return { set: {}, cancelTimeout: false, enqueueTimeout: false, newDeadline: null };
}
