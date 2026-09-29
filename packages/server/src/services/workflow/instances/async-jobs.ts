// ─── 任务异步作业（延时唤醒/触发器重试/超时）（拆分自 workflow-instances.service.ts）───
import { eq } from 'drizzle-orm';
import { computeWorkCalendarDeadline } from '@zenith/shared/workflow';
import { db } from '../../../db';
import { workflowInstances, workflowTasks } from '../../../db/schema';
import { type TaskAction } from '../../../lib/workflow-engine';
import type { WorkflowFlowData, WorkflowTimeoutConfig } from '@zenith/shared/workflow';
import type { DbExecutor } from '../../../db/types';
import { enqueueJob } from '../../../lib/workflow-jobs/engine';
import { computeTimeoutAt } from '../../../lib/workflow-timeout';
import { loadWorkCalendar } from '../calendars.service';
import type { WorkflowTriggerNodeConfig } from '@zenith/shared/workflow';
import dayjs from 'dayjs';

/**
 * 子实例结束后入队 subprocess_join 作业唤醒/汇聚父任务（取代直接 resumeParentSubProcess 调用）。
 * 幂等键含 childInst.id，确保每个子实例的结束都触发一次（多实例汇聚靠 reconcile 绝对重算收敛）。
 */
export async function enqueueSubprocessJoin(childInst: typeof workflowInstances.$inferSelect): Promise<void> {
  if (!childInst.parentTaskId) return;
  await enqueueJob({
    jobType: 'subprocess_join',
    taskId: childInst.parentTaskId,
    instanceId: childInst.parentInstanceId ?? null,
    payload: { parentTaskId: childInst.parentTaskId },
    maxAttempts: 5,
    idempotencyKey: `subprocess_join:${childInst.parentTaskId}:${childInst.id}`,
    tenantId: childInst.tenantId ?? null,
  });
}

function computeDelayWakeAt(nodeConfig: TaskAction['nodeConfig'], formData: Record<string, unknown>): Date {
  const delayType = nodeConfig.delayType ?? 'fixed';
  if (delayType === 'toDate') {
    const key = nodeConfig.targetDate;
    const raw = key ? formData[key] : undefined;
    if (raw) {
      const d = dayjs(raw as string | number | Date);
      if (d.isValid()) return d.toDate();
    }
    return new Date();
  }
  const value = Number(nodeConfig.delayValue ?? 0);
  const unit = (nodeConfig.delayUnit ?? 'hour') as 'minute' | 'hour' | 'day';
  if (!Number.isFinite(value) || value <= 0) return new Date();
  return dayjs().add(value, unit).toDate();
}

/** 触发器最大尝试次数：continue=1，block=1+maxRetries（封顶 11） */
function resolveTriggerMaxAttempts(cfg?: WorkflowTriggerNodeConfig): number {
  const onFailure = cfg?.onFailure ?? 'continue';
  if (onFailure === 'continue') return 1;
  return Math.min(11, Math.max(1, (cfg?.maxRetries ?? 0) + 1));
}

/**
 * 为新建任务挂载异步作业（统一作业账本）：延时唤醒、审批超时、触发器派发、外部审批派发。
 * 子流程（spawn/join）仍走既有 maybeSpawnSubProcessChild / 恢复巡检，不在此处理。
 * 默认用 db 执行器（在提交后的事件发射循环中调用）。
 */
export async function armTaskAsyncJobs(
  task: typeof workflowTasks.$inferSelect,
  inst: { id: number; flowData: WorkflowFlowData | null; formData: Record<string, unknown> | null; tenantId: number | null },
  executor: DbExecutor = db,
  slaOverride?: { duration: number; unit: 'minutes' | 'hours' | 'days' | 'workdays' } | null,
): Promise<void> {
  const cfg = inst.flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  if (!cfg) return;
  const tenantId = inst.tenantId ?? null;
  const base = { instanceId: inst.id, nodeKey: task.nodeKey, taskId: task.id, tenantId, payload: { taskId: task.id } } as const;

  if (task.nodeType === 'subProcess') {
    await enqueueJob({ ...base, jobType: 'subprocess_spawn', maxAttempts: 5, idempotencyKey: `subprocess_spawn:${task.id}` }, executor);
    return;
  }
  if (task.nodeType === 'delay' && task.status === 'waiting') {
    await enqueueJob({ ...base, jobType: 'delay_wake', runAt: computeDelayWakeAt(cfg, (inst.formData ?? {}) as Record<string, unknown>), maxAttempts: 3, idempotencyKey: `delay_wake:${task.id}` }, executor);
    return;
  }
  if (task.nodeType === 'trigger') {
    await enqueueJob({
      ...base,
      jobType: 'trigger_dispatch',
      // triggerType 只存在于定义快照的节点配置，读取侧拿不到，随作业落库；
      // nodeName 不复制，读取侧从 workflow_tasks.node_name 取权威值
      payload: { taskId: task.id, triggerType: cfg.triggerConfig?.triggerType ?? 'webhook' },
      maxAttempts: resolveTriggerMaxAttempts(cfg.triggerConfig),
      idempotencyKey: `trigger_dispatch:${task.id}`,
    }, executor);
    return;
  }
  if (task.nodeType === 'approve' && task.status === 'waiting' && task.externalCallbackId && cfg.externalApproval?.enabled) {
    await enqueueJob({ ...base, jobType: 'external_dispatch', maxAttempts: 3, idempotencyKey: `external_dispatch:${task.id}` }, executor);
    return;
  }
  if ((task.nodeType === 'approve' || task.nodeType === 'handler') && task.status === 'pending') {
    await scheduleTaskTimeout(executor, task, cfg.timeout, inst.id, tenantId, slaOverride);
  }
}

/**
 * 为任务排「超时」作业（统一作业账本）：
 * - 智能 SLA（§2.6）：按工作日历口径算截止、落库 slaStatus/slaStartedAt/slaDeadline，再排 task_timeout；日历不可用则降级官方墙钟。
 * - 否则（墙钟模式）：computeTimeoutAt 直接排程。
 * 供任务创建（armTaskAsyncJobs）与串行节点下游任务提升（materialize）共用，避免两处口径不一致。
 */
export async function scheduleTaskTimeout(
  executor: DbExecutor,
  task: { id: number; nodeKey: string | null },
  cfgTimeout: WorkflowTimeoutConfig | undefined | null,
  instanceId: number,
  tenantId: number | null = null,
  override?: { duration: number; unit: 'minutes' | 'hours' | 'days' | 'workdays' } | null,
): Promise<void> {
  const base = {
    instanceId,
    nodeKey: task.nodeKey,
    taskId: task.id,
    tenantId,
    payload: { taskId: task.id },
  } as const;

  if (!cfgTimeout?.enabled) return;

  const startAt = new Date();
  let deadline: Date | null = null;

  // 智能 SLA：优先按工作日历口径算截止（跳过午休 / 周末 / 节假日）
  if (cfgTimeout.timeoutMode === 'smart' && cfgTimeout.smartSla?.enabled && cfgTimeout.smartSla.calendarId) {
    const cal = await loadWorkCalendar(cfgTimeout.smartSla.calendarId, executor);
    if (cal) {
      const dur = override?.duration ?? cfgTimeout.smartSla.duration;
      const unit = override?.unit ?? cfgTimeout.smartSla.unit ?? 'hours';
      deadline = computeWorkCalendarDeadline(startAt, dur, unit, cal);
    }
    // cal==null / 扫描耗尽 → deadline 仍为 null，下方降级官方墙钟（D6：绝不静默吞掉）
  }

  // 墙钟模式 或 智能日历不可用：官方墙钟口径兜底；同样落库 SLA 列，保持时钟状态一致
  if (!deadline) {
    const dur = override?.duration ?? cfgTimeout.duration;
    const unit = (override?.unit ?? cfgTimeout.unit ?? 'hours') as 'minutes' | 'hours' | 'days';
    deadline = computeTimeoutAt({ ...cfgTimeout, duration: dur, unit }, startAt);
  }

  if (deadline) {
    await executor.update(workflowTasks)
      .set({ slaStatus: 'RUNNING', slaStartedAt: startAt, slaDeadline: deadline })
      .where(eq(workflowTasks.id, task.id));
    await enqueueJob({ ...base, jobType: 'task_timeout', runAt: deadline, maxAttempts: 3, idempotencyKey: `task_timeout:${task.id}` }, executor);
  }
}

/**
 * 依据上游「通过」时挑选的 optionKey，从节点自定义时限组中解析出真实 duration/unit（供 scheduleTaskTimeout 覆盖默认项）。
 * - optionKey 为空 → 返回 undefined（用设计器默认单值，即默认项同步值）。
 * - 找不到对应组 / key → 返回 undefined（安全回退默认项，绝不破坏墙钟 / 智能计时）。
 */
export function resolveSlaOverride(
  flowData: WorkflowFlowData | undefined,
  nodeKey: string,
  optionKey?: string,
): { duration: number; unit: 'minutes' | 'hours' | 'days' | 'workdays' } | undefined {
  if (!optionKey) return undefined;
  const t = flowData?.nodes?.find((n) => n.data.key === nodeKey)?.data.timeout;
  if (!t) return undefined;
  const group = t.timeoutMode === 'smart' ? t.smartSla?.options : t.wallclockOptions;
  const picked = group?.find((o) => o.key === optionKey);
  return picked ? { duration: picked.duration, unit: picked.unit } : undefined;
}
