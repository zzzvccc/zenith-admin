import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/workflow-jobs/engine', () => ({
  enqueueJob: vi.fn(),
}));
vi.mock('../calendars.service', () => ({
  loadWorkCalendar: vi.fn(),
}));

import { enqueueJob } from '../../../lib/workflow-jobs/engine';
import { loadWorkCalendar } from '../calendars.service';
import { scheduleTaskTimeout } from './async-jobs';
import type { WorkflowTimeoutConfig } from '@zenith/shared/workflow';

const mockedEnqueue = vi.mocked(enqueueJob);
const mockedLoad = vi.mocked(loadWorkCalendar);

function makeExecutor() {
  const updates: Array<{ values: Record<string, unknown> }> = [];
  const executor: any = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ values });
        return { where: () => undefined };
      },
    }),
  };
  return { executor, updates };
}

const CAL = {
  timezone: 'Asia/Shanghai',
  workdays: [1, 2, 3, 4, 5],
  dailyHours: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
  holidays: [],
};

beforeEach(() => {
  mockedEnqueue.mockReset();
  mockedLoad.mockReset();
});

describe('scheduleTaskTimeout（任务创建 / 串行下游共用）', () => {
  it('smart 模式：写入 SLA 列并按工作日历截止排程', async () => {
    mockedLoad.mockResolvedValue(CAL as any);
    const { executor, updates } = makeExecutor();
    const cfg = {
      enabled: true, timeoutMode: 'smart',
      smartSla: { enabled: true, duration: 4, unit: 'hours', calendarId: 1 },
    } as unknown as WorkflowTimeoutConfig;
    await scheduleTaskTimeout(executor, { id: 7, nodeKey: 'n1' }, cfg, 100, null);

    expect(updates).toHaveLength(1);
    expect(updates[0].values.slaStatus).toBe('RUNNING');
    expect(updates[0].values.slaStartedAt).toBeInstanceOf(Date);
    const deadline = updates[0].values.slaDeadline as Date;
    expect(deadline).toBeInstanceOf(Date);
    expect(mockedEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'task_timeout', runAt: deadline, idempotencyKey: 'task_timeout:7' }),
      executor,
    );
  });

  it('smart 模式且日历不可用：降级官方墙钟、仍落 SLA 列（保持时钟状态一致，§2.8 双轨制）', async () => {
    mockedLoad.mockResolvedValue(null);
    const { executor, updates } = makeExecutor();
    const cfg = {
      enabled: true, timeoutMode: 'smart', duration: 6, unit: 'hours',
      smartSla: { enabled: true, duration: 4, unit: 'hours', calendarId: 1 },
    } as unknown as WorkflowTimeoutConfig;
    await scheduleTaskTimeout(executor, { id: 8, nodeKey: 'n1' }, cfg, 100, null);

    // 第三章 §4 抽出共享 scheduleTaskTimeout 后，墙钟/降级路径同样落 SLA 列（slaStatus/slaStartedAt/slaDeadline），
    // 以统一走 queries.ts:computeTaskSlaSmart 的「落库优先」分支，保持墙钟下 WorkflowSLATag 不变（§3.7）。
    // 旧断言「墙钟不落 SLA 列」已随该改造过时，此处更正为「落列但口径等价」。
    expect(updates).toHaveLength(1);
    expect(updates[0].values.slaStatus).toBe('RUNNING');
    expect(updates[0].values.slaDeadline).toBeInstanceOf(Date);
    const deadline = updates[0].values.slaDeadline as Date;
    expect(mockedEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'task_timeout', runAt: deadline, idempotencyKey: 'task_timeout:8' }),
      executor,
    );
  });

  it('墙钟模式：落 SLA 列并按 computeTimeoutAt 排程', async () => {
    const { executor, updates } = makeExecutor();
    const cfg = {
      enabled: true, timeoutMode: 'wallclock', duration: 6, unit: 'hours',
    } as unknown as WorkflowTimeoutConfig;
    await scheduleTaskTimeout(executor, { id: 9, nodeKey: 'n1' }, cfg, 100, null);

    // 同上：墙钟路径现已统一落 SLA 列（保持时钟状态一致），deadline 仍为 computeTimeoutAt 墙钟口径。
    expect(updates).toHaveLength(1);
    expect(updates[0].values.slaStatus).toBe('RUNNING');
    expect(updates[0].values.slaDeadline).toBeInstanceOf(Date);
    const call = mockedEnqueue.mock.calls[0][0] as any;
    expect(call.jobType).toBe('task_timeout');
    expect(call.runAt.getTime()).toBeCloseTo(Date.now() + 6 * 3600 * 1000, -2);
  });
});
