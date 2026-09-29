// ─── SLA 申请（延时 / 挂起 / 恢复）与 SLA 审批决议（§2.10，含 D3–D6 修正）───
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { WorkflowNodeConfig, WorkflowResolvedApproveMethod, WorkflowSlaApprover, WorkflowSlaRequest } from '@zenith/shared/workflow';
import { applySlaDecision, type SlaRequestKind, type SlaTaskClockState } from './sla-clock';
import { db } from '../../../db';
import { workflowInstances, workflowTaskSlaRequests, workflowTasks } from '../../../db/schema';
import type { DbExecutor } from '../../../db/types';
import { enqueueJob, cancelJobs } from '../../../lib/workflow-jobs/engine';
import { resolveRuntimeApproveMethod } from '../../../lib/workflow-engine';
import { resolveAssigneeIds } from '../workflow-assignee-resolver.service';
import { loadWorkCalendar } from '../calendars.service';
import { resolveUserNames } from '../../../lib/user-nicknames';
import { formatDateTime } from '../../../lib/datetime';
import { lockInstanceExpecting, emitTasksEnteredEvents } from './shared';

type SlaRequestType = 'DELAY' | 'SUSPEND' | 'RESUME';

interface SlaActor { userId: number; name?: string | null }

/**
 * SLA 审批人解析（伪节点法）。
 * ★D3：`resolveAssigneeIds` 读的是 `node.assigneeType` 而非 `node.type`，
 * 缺失会直接 return []，因此必须显式透传 assigneeType 与全部审批人字段。
 */
async function resolveSlaApproverIds(
  approver: WorkflowSlaApprover,
  ctx: { initiatorId: number; executor: DbExecutor; instanceId: number; formData?: Record<string, unknown> },
): Promise<number[]> {
  const pseudoNode = {
    type: 'approve', key: 'sla', label: 'SLA 审批',
    assigneeType: approver.assigneeType,
    userIds: approver.userIds,
    roleIds: approver.roleIds,
    deptIds: approver.deptIds,
    userGroupIds: approver.userGroupIds,
    postIds: approver.postIds,
  } as unknown as WorkflowNodeConfig;
  return resolveAssigneeIds(pseudoNode, {
    initiatorId: ctx.initiatorId,
    executor: ctx.executor,
    instanceId: ctx.instanceId,
    formData: ctx.formData,
  });
}

/** 会签决议：siblings = 同 (instanceId, slaNodeKey, activationId) 的任务行 */
type SlaResolution = { decided: false } | { decided: true; approve: boolean };

function resolveSlaResolution(
  siblings: Array<{ status: string; approveMethod: string | null; approveRatio: number | null }>,
): SlaResolution {
  if (siblings.some((t) => t.status === 'rejected')) return { decided: true, approve: false };
  const method = siblings.find((t) => t.approveMethod)?.approveMethod ?? 'or';
  const approved = siblings.filter((t) => t.status === 'approved').length;
  if (method === 'or') return approved >= 1 ? { decided: true, approve: true } : { decided: false };
  if (method === 'and') return siblings.every((t) => t.status === 'approved') ? { decided: true, approve: true } : { decided: false };
  if (method === 'ratio') {
    const ratio = siblings.find((t) => t.approveRatio != null)?.approveRatio ?? 51;
    return approved * 100 >= siblings.length * ratio ? { decided: true, approve: true } : { decided: false };
  }
  // sequential：全 approved 才过（逐人唤醒由下方升 pending 逻辑配合）
  return siblings.every((t) => t.status === 'approved') ? { decided: true, approve: true } : { decided: false };
}

/** 发起 SLA 申请：生成独立 slaApprove 任务行（原处理人任务保持 pending） */
export async function createSlaRequest(
  actor: SlaActor,
  taskId: number,
  input: { type: SlaRequestType; duration?: string; requestedMs?: number; reason?: string },
) {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '实例不存在' });
  const cfg = inst.definitionSnapshot?.flowData?.nodes?.find((n) => n.data.key === task.nodeKey)?.data;
  const sla = cfg?.timeout?.smartSla;
  if (!sla?.enabled) throw new HTTPException(400, { message: '该节点未启用智能 SLA' });
  if (input.type === 'DELAY' && !sla.allowDelay) throw new HTTPException(400, { message: '该节点不允许延时' });
  if (input.type === 'SUSPEND' && !sla.allowSuspend) throw new HTTPException(400, { message: '该节点不允许挂起' });
  if (input.type === 'RESUME' && task.slaStatus !== 'SUSPENDED') throw new HTTPException(400, { message: '任务未挂起，无需恢复' });
  if (input.type === 'DELAY' && sla.maxDelayCount > 0) {
    const used = await db.$count(workflowTaskSlaRequests, and(
      eq(workflowTaskSlaRequests.taskId, taskId),
      eq(workflowTaskSlaRequests.type, 'DELAY'),
      eq(workflowTaskSlaRequests.status, 'APPROVED'),
    ));
    if (used >= sla.maxDelayCount) throw new HTTPException(400, { message: `延时次数已达上限 ${sla.maxDelayCount}` });
  }
  if (input.type === 'SUSPEND' && sla.maxSuspendCount > 0) {
    const used = await db.$count(workflowTaskSlaRequests, and(
      eq(workflowTaskSlaRequests.taskId, taskId),
      eq(workflowTaskSlaRequests.type, 'SUSPEND'),
      eq(workflowTaskSlaRequests.status, 'APPROVED'),
    ));
    if (used >= sla.maxSuspendCount) throw new HTTPException(400, { message: `挂起次数已达上限 ${sla.maxSuspendCount}` });
  }

  const created = await db.transaction(async (tx) => {
    await lockInstanceExpecting(tx, inst.id, 'running', '实例非运行中');

    // 1) 解析审批人（多人多策略并集去重）
    const ids = new Set<number>();
    for (const a of sla.slaApprovers) {
      for (const uid of await resolveSlaApproverIds(a, {
        initiatorId: inst.initiatorId,
        executor: tx,
        instanceId: inst.id,
        formData: inst.formData as Record<string, unknown> | undefined,
      })) ids.add(uid);
    }
    const approverIds = [...ids];
    if (approverIds.length === 0) throw new HTTPException(400, { message: 'SLA 审批人解析为空' });

    // 2) 写申请明细（slaNodeKey 先占位，拿到 reqId 后回填）
    const [req] = await tx.insert(workflowTaskSlaRequests).values({
      taskId,
      instanceId: inst.id,
      nodeId: task.nodeKey,
      slaNodeKey: '',
      type: input.type,
      applicantId: actor.userId,
      applicantName: actor.name ?? null,
      requestedDuration: input.duration ?? null,
      requestedMs: input.requestedMs ?? null,
      reason: input.reason ?? null,
      slaApproverIds: approverIds,
      status: 'PENDING',
      tenantId: inst.tenantId,
    }).returning();
    const slaNodeKey = `${task.nodeKey}__sla${input.type.toLowerCase()}${req.id}`;

    // 3) 生成 slaApprove 任务行（会签策略追随节点）
    const method: WorkflowResolvedApproveMethod = resolveRuntimeApproveMethod(cfg?.approveMethod ?? 'or', approverIds.length);
    const activation = randomUUID();   // 必填；天然规避 wf_tasks_active_uniq
    const rows = approverIds.map((uid, i) => ({
      instanceId: inst.id,
      nodeKey: slaNodeKey,
      nodeName: `SLA${input.type}`,
      nodeType: 'slaApprove' as const,
      assigneeId: uid,
      status: method === 'sequential' ? (i === 0 ? 'pending' as const : 'waiting' as const) : 'pending' as const,
      approveMethod: method,
      // ★D2：ratio 会签必须写入 approveRatio，否则决议永远退化为默认 51%
      approveRatio: method === 'ratio' ? (cfg?.approveRatio ?? 51) : null,
      activationId: activation,
      taskOrder: method === 'sequential' ? i : null,
      tenantId: inst.tenantId,
    }));
    const inserted = await tx.insert(workflowTasks).values(rows).returning();

    // 4) 回填批次键
    await tx.update(workflowTaskSlaRequests).set({ slaNodeKey }).where(eq(workflowTaskSlaRequests.id, req.id));

    // 5) 发射事件（待办角标 / WS 刷新）
    await emitTasksEnteredEvents(inst.id, inserted, {
      definitionId: inst.definitionId,
      tenantId: inst.tenantId ?? null,
      actor,
    }, tx);
    return req;
  });

  return {
    id: created.id,
    taskId: created.taskId,
    type: created.type as SlaRequestType,
    applicantName: actor.name ?? `用户#${actor.userId}`,
    status: 'PENDING' as const,
    requestedDuration: created.requestedDuration,
    reason: created.reason,
    result: created.result,
    approverName: null,
    createdAt: formatDateTime(created.createdAt),
  };
}

/**
 * SLA 审批决议（★按 taskId 寻址，前端零新增字段，复用审批 Sheet 已有的 taskId）。
 * 决议通过后按 type 改时钟；原处理人任务 status 全程 pending。
 */
export async function decideSlaTask(actor: SlaActor, taskId: number, approve: boolean, comment: string) {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task || task.nodeType !== 'slaApprove') throw new HTTPException(404, { message: 'SLA 审批任务不存在' });
  if (task.status !== 'pending') throw new HTTPException(409, { message: '该任务已处理' });
  if (task.assigneeId !== actor.userId) throw new HTTPException(403, { message: '非本任务审批人' });
  const [req] = await db.select().from(workflowTaskSlaRequests)
    .where(eq(workflowTaskSlaRequests.slaNodeKey, task.nodeKey)).limit(1);
  if (!req || req.status !== 'PENDING') throw new HTTPException(409, { message: '该申请已处理' });

  return db.transaction(async (tx) => {
    await lockInstanceExpecting(tx, task.instanceId, 'running', '实例非运行中');

    // 1) 乐观并发置本行状态（进已办）
    const updated = await tx.update(workflowTasks)
      .set({ status: approve ? 'approved' : 'rejected', actionAt: new Date(), comment })
      .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.status, 'pending')))
      .returning();
    if (updated.length === 0) throw new HTTPException(409, { message: '任务已被处理' });

    // 2) 查兄弟行 → 会签决议
    const siblings = await tx.select().from(workflowTasks)
      .where(and(
        eq(workflowTasks.instanceId, task.instanceId),
        eq(workflowTasks.nodeKey, task.nodeKey),
        eq(workflowTasks.activationId, task.activationId),
      ));
    const resolution = resolveSlaResolution(siblings);

    // sequential：唤醒下一个 waiting
    if (!resolution.decided && siblings.some((s) => s.status === 'waiting')) {
      const next = siblings.filter((s) => s.status === 'waiting')
        .sort((a, b) => (a.taskOrder ?? 0) - (b.taskOrder ?? 0))[0];
      if (next) await tx.update(workflowTasks).set({ status: 'pending' }).where(eq(workflowTasks.id, next.id));
      return { decided: false };
    }
    if (!resolution.decided) return { decided: false };

    // 3) 决议达成 → 联动跳过兄弟行 + 置申请状态
    await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), comment: '[SLA 决议] 其它审批人无需处理' })
      .where(and(
        eq(workflowTasks.instanceId, task.instanceId),
        eq(workflowTasks.nodeKey, task.nodeKey),
        inArray(workflowTasks.status, ['pending', 'waiting']),
      ));
    await tx.update(workflowTaskSlaRequests).set({
      status: resolution.approve ? 'APPROVED' : 'REJECTED',
      approverId: actor.userId,
      approverName: actor.name ?? null,
      approvedAt: new Date(),
      result: comment,
    }).where(eq(workflowTaskSlaRequests.id, req.id));
    if (!resolution.approve) return { decided: true, approve: false };   // 决议驳回 → 不改时钟

    // 4) 决议通过 → 按 type 改时钟（只动原处理人任务 req.taskId）
    const [orig] = await tx.select().from(workflowTasks).where(eq(workflowTasks.id, req.taskId)).limit(1);
    const instRow = (await tx.select().from(workflowInstances).where(eq(workflowInstances.id, req.instanceId)).limit(1))[0];
    const cfg = instRow?.definitionSnapshot?.flowData?.nodes?.find((n) => n.data.key === orig?.nodeKey)?.data;
    // 租户归属在实例上（workflowTasks 无 tenantId 列）
    const tenantId = instRow?.tenantId ?? null;
    const sla = cfg?.timeout?.smartSla;
    if (!orig || !sla) return { decided: true, approve: true };
    const cal = await loadWorkCalendar(sla.calendarId, tx);

    const clockTask: SlaTaskClockState = {
      slaStatus: orig.slaStatus,
      slaStartedAt: orig.slaStartedAt,
      slaDeadline: orig.slaDeadline,
      slaWorkElapsedMs: orig.slaWorkElapsedMs,
      slaSuspendedAt: orig.slaSuspendedAt,
    };
    const decision = applySlaDecision({
      type: req.type as SlaRequestKind,
      requestedMs: req.requestedMs,
      task: clockTask,
      sla: { duration: sla.duration, unit: sla.unit },
      cal,
      now: new Date(),
    });
    if (Object.keys(decision.set).length > 0) {
      await tx.update(workflowTasks).set(decision.set as Partial<typeof workflowTasks.$inferInsert>)
        .where(eq(workflowTasks.id, orig.id));
    }
    if (decision.cancelTimeout) await cancelJobs({ taskId: orig.id, jobType: 'task_timeout' }, tx);
    if (decision.enqueueTimeout && decision.newDeadline) {
      await enqueueJob({
        jobType: 'task_timeout', taskId: orig.id, instanceId: orig.instanceId,
        payload: { taskId: orig.id }, runAt: decision.newDeadline, maxAttempts: 3,
        idempotencyKey: `task_timeout:${orig.id}`, tenantId,
      }, tx);
    }
    return { decided: true, approve: true };
  });
}

/** 单任务的 SLA 申请列表（契约 op `slaRequests` 用） */
export async function listTaskSlaRequests(taskId: number): Promise<WorkflowSlaRequest[]> {
  const rows = await db.select().from(workflowTaskSlaRequests)
    .where(eq(workflowTaskSlaRequests.taskId, taskId))
    .orderBy(workflowTaskSlaRequests.id);
  if (rows.length === 0) return [];
  const names = await resolveUserNames(rows.flatMap((r) => [r.applicantId, r.approverId].filter((v): v is number => v != null)));
  return rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    type: r.type as SlaRequestType,
    applicantName: names.get(r.applicantId) ?? `用户#${r.applicantId}`,
    status: r.status as 'PENDING' | 'APPROVED' | 'REJECTED',
    requestedDuration: r.requestedDuration,
    reason: r.reason,
    result: r.result,
    approverName: r.approverId != null ? names.get(r.approverId) ?? `用户#${r.approverId}` : null,
    createdAt: formatDateTime(r.createdAt),
  }));
}

/** 详情场景：按实例批量加载 SLA 申请并按 taskId 分组（含申请人/审批人昵称） */
export async function loadInstanceSlaRequestsByTask(instanceId: number): Promise<Map<number, WorkflowSlaRequest[]>> {
  const rows = await db.select().from(workflowTaskSlaRequests)
    .where(eq(workflowTaskSlaRequests.instanceId, instanceId))
    .orderBy(workflowTaskSlaRequests.id);
  const map = new Map<number, WorkflowSlaRequest[]>();
  if (rows.length === 0) return map;
  const names = await resolveUserNames(rows.flatMap((r) => [r.applicantId, r.approverId].filter((v): v is number => v != null)));
  for (const r of rows) {
    const list = map.get(r.taskId) ?? [];
    list.push({
      id: r.id,
      taskId: r.taskId,
      type: r.type as SlaRequestType,
      applicantName: names.get(r.applicantId) ?? `用户#${r.applicantId}`,
      status: r.status as 'PENDING' | 'APPROVED' | 'REJECTED',
      requestedDuration: r.requestedDuration,
      reason: r.reason,
      result: r.result,
      approverName: r.approverId != null ? names.get(r.approverId) ?? `用户#${r.approverId}` : null,
      createdAt: formatDateTime(r.createdAt),
    });
    map.set(r.taskId, list);
  }
  return map;
}
