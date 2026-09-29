import { redactWorkflowSignatureImages } from '../../../services/workflow/instances/signature-audit';
// ─── 审批动作：同意/拒绝/下一步审批人 ───
import { workflowTaskContract } from '@zenith/shared/workflow';
import { setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { approveTask, rejectTask, getWorkflowTaskBeforeAudit, listTaskSelectableNextApprovers, listTaskSelectableNextSlaOptions } from '../../../services/workflow/workflow-instances.service';

export const approveRoute = defineContractRoute(workflowTaskContract.approve, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { comment, attachments, selectedNextApprovers, signature, formUpdates } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const result = await approveTask(taskId, comment, attachments, selectedNextApprovers, signature, formUpdates);
    setAuditAfterData(c, redactWorkflowSignatureImages(result.instance));
    return c.json(okBody(result.instance, result.message), 200);
  },
});

export const selectableNextApproversRoute = defineContractRoute(workflowTaskContract.selectableNextApprovers, {
  handler: async (c) => c.json(okBody(await listTaskSelectableNextApprovers(c.req.valid('param').taskId, c.req.valid('query'))), 200),
});

export const selectableNextSlaOptionsRoute = defineContractRoute(workflowTaskContract.selectableNextSlaOptions, {
  handler: async (c) => c.json(okBody(await listTaskSelectableNextSlaOptions(c.req.valid('param').taskId)), 200),
});

export const rejectRoute = defineContractRoute(workflowTaskContract.reject, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await rejectTask(taskId, comment, attachments);
    setAuditAfterData(c, redactWorkflowSignatureImages(r.instance));
    return c.json(okBody(r.instance, r.message), 200);
  },
});
