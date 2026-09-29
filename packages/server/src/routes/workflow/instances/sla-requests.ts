// ─── SLA 申请（延时 / 挂起 / 恢复）与 SLA 审批决议 ───
import { workflowTaskContract } from '@zenith/shared/workflow';
import { setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { getWorkflowTaskBeforeAudit } from '../../../services/workflow/workflow-instances.service';
import { createSlaRequest, decideSlaTask, listTaskSlaRequests } from '../../../services/workflow/instances/sla-requests';
import { currentUser, currentUsername } from '../../../lib/context';

export const listSlaRequestsRoute = defineContractRoute(workflowTaskContract.slaRequests, {
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    return c.json(okBody(await listTaskSlaRequests(taskId)), 200);
  },
});

export const createSlaRequestRoute = defineContractRoute(workflowTaskContract.createSlaRequest, {
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const actor = { userId: currentUser().userId, name: currentUsername() };
    const result = await createSlaRequest(actor, taskId, c.req.valid('json'));
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(result, 'SLA 申请已提交'), 200);
  },
});

export const decideSlaTaskRoute = defineContractRoute(workflowTaskContract.decideSlaTask, {
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const actor = { userId: currentUser().userId, name: currentUsername() };
    const { approve, comment } = c.req.valid('json');
    const result = await decideSlaTask(actor, taskId, approve, comment);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(result, result.decided && result.approve ? 'SLA 申请已通过' : result.decided ? 'SLA 申请已驳回' : '已记录，等待其余审批人'), 200);
  },
});
