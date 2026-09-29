/**
 * 服务端「工时选择」白名单单测（无 DB）。
 * 覆盖两层防线：
 *  1. resolveSlaOverride —— 上游「通过」时传来的 optionKey 必须命中节点预设组，
 *     伪造 / 缺失 key 一律回退 undefined（绝不信任前端 duration，杜绝超时篡改）。
 *  2. scheduleTaskTimeout —— override 注入后优先于设计器默认单值，落到 deadline / 排程时刻。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/workflow-jobs/engine', () => ({ enqueueJob: vi.fn() }));
vi.mock('../calendars.service', () => ({ loadWorkCalendar: vi.fn() }));

import { enqueueJob } from '../../../lib/workflow-jobs/engine';
import { loadWorkCalendar } from '../calendars.service';
import { resolveSlaOverride, scheduleTaskTimeout, armTaskAsyncJobs } from './async-jobs';
import type { WorkflowFlowData, WorkflowTimeoutConfig } from '@zenith/shared/workflow';

const mockedEnqueue = vi.mocked(enqueueJob);
const mockedLoad = vi.mocked(loadWorkCalendar);

const CAL = {
  timezone: 'Asia/Shanghai',
  workdays: [1, 2, 3, 4, 5],
  dailyHours: [{ start: '09:00', end: '18:00' }],
  holidays: [],
};

/** 构造最小 flowData：仅含一个 key='target' 的节点与其 timeout 配置 */
function makeFlowData(timeout: unknown): WorkflowFlowData {
  return {
    nodes: [{ data: { key: 'target', label: '下游', timeout } }],
  } as unknown as WorkflowFlowData;
}

beforeEach(() => {
  mockedEnqueue.mockReset();
  mockedLoad.mockReset();
});

describe('resolveSlaOverride 白名单解析', () => {
  const wallclockTimeout = {
    enabled: true,
    timeoutMode: 'wallclock',
    duration: 6,
    unit: 'hours',
    wallclockOptions: [
      { key: 'w-fast', label: '快', duration: 2, unit: 'hours' },
      { key: 'w-slow', label: '慢', duration: 1, unit: 'days' },
    ],
  };
  const smartTimeout = {
    enabled: true,
    timeoutMode: 'smart',
    smartSla: {
      enabled: true,
      duration: 4,
      unit: 'hours',
      calendarId: 1,
      options: [
        { key: 's-fast', label: '快', duration: 2, unit: 'hours' },
        { key: 's-slow', label: '慢', duration: 3, unit: 'workdays' },
      ],
    },
  };

  it('optionKey 为空 → 返回 undefined（用设计器默认单值）', () => {
    expect(resolveSlaOverride(makeFlowData(wallclockTimeout), 'target', '')).toBeUndefined();
    expect(resolveSlaOverride(makeFlowData(wallclockTimeout), 'target', undefined)).toBeUndefined();
  });

  it('节点无 timeout → 返回 undefined', () => {
    expect(resolveSlaOverride(makeFlowData({ enabled: false }), 'target', 'w-fast')).toBeUndefined();
    expect(resolveSlaOverride(undefined, 'target', 'w-fast')).toBeUndefined();
  });

  it('wallclock 模式：命中 key 解析真实 duration/unit', () => {
    expect(resolveSlaOverride(makeFlowData(wallclockTimeout), 'target', 'w-fast')).toEqual({ duration: 2, unit: 'hours' });
    expect(resolveSlaOverride(makeFlowData(wallclockTimeout), 'target', 'w-slow')).toEqual({ duration: 1, unit: 'days' });
  });

  it('wallclock 模式：伪造 / 不存在的 key → undefined（白名单拦截，防篡改）', () => {
    expect(resolveSlaOverride(makeFlowData(wallclockTimeout), 'target', 'forged')).toBeUndefined();
    expect(resolveSlaOverride(makeFlowData(wallclockTimeout), 'target', 's-fast')).toBeUndefined();
  });

  it('smart 模式：命中 key 从 smartSla.options 解析（而非 wallclock 组）', () => {
    expect(resolveSlaOverride(makeFlowData(smartTimeout), 'target', 's-fast')).toEqual({ duration: 2, unit: 'hours' });
    expect(resolveSlaOverride(makeFlowData(smartTimeout), 'target', 's-slow')).toEqual({ duration: 3, unit: 'workdays' });
  });

  it('smart 模式：伪造 / 跨组 key → undefined', () => {
    expect(resolveSlaOverride(makeFlowData(smartTimeout), 'target', 'w-fast')).toBeUndefined();
    expect(resolveSlaOverride(makeFlowData(smartTimeout), 'target', 'nope')).toBeUndefined();
  });

  it('timeoutMode 缺失默认按 wallclockOptions 解析', () => {
    const noMode = { enabled: true, duration: 6, unit: 'hours', wallclockOptions: [{ key: 'x', label: 'x', duration: 30, unit: 'minutes' }] };
    expect(resolveSlaOverride(makeFlowData(noMode), 'target', 'x')).toEqual({ duration: 30, unit: 'minutes' });
  });
});

describe('scheduleTaskTimeout override 注入', () => {
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

  it('smart 模式：override 优先于 smartSla.duration，截止更早', async () => {
    mockedLoad.mockResolvedValue(CAL as any);
    const cfg = {
      enabled: true, timeoutMode: 'smart',
      smartSla: { enabled: true, duration: 4, unit: 'hours', calendarId: 1 },
    } as unknown as WorkflowTimeoutConfig;

    const a = makeExecutor();
    await scheduleTaskTimeout(a.executor, { id: 1, nodeKey: 'target' }, cfg, 100, null, { duration: 2, unit: 'hours' });
    const b = makeExecutor();
    await scheduleTaskTimeout(b.executor, { id: 1, nodeKey: 'target' }, cfg, 100, null, { duration: 4, unit: 'hours' });

    const d2 = a.updates[0].values.slaDeadline as Date;
    const d4 = b.updates[0].values.slaDeadline as Date;
    expect(d2).toBeInstanceOf(Date);
    // 2 工作小时 < 4 工作小时 → 截止更早
    expect(d2.getTime()).toBeLessThan(d4.getTime());
  });

  it('墙钟模式：override 覆盖默认单值，排程时刻按 override 计算', async () => {
    const cfg = {
      enabled: true, timeoutMode: 'wallclock', duration: 6, unit: 'hours',
    } as unknown as WorkflowTimeoutConfig;

    const a = makeExecutor();
    await scheduleTaskTimeout(a.executor, { id: 2, nodeKey: 'target' }, cfg, 100, null, { duration: 2, unit: 'hours' });
    const b = makeExecutor();
    await scheduleTaskTimeout(b.executor, { id: 2, nodeKey: 'target' }, cfg, 100, null); // 无 override → 默认 6h

    const runAt2 = (mockedEnqueue.mock.calls[0][0] as any).runAt as Date;
    const runAt6 = (mockedEnqueue.mock.calls[1][0] as any).runAt as Date;
    expect(runAt2.getTime()).toBeCloseTo(Date.now() + 2 * 3600 * 1000, -2);
    expect(runAt6.getTime()).toBeCloseTo(Date.now() + 6 * 3600 * 1000, -2);
    expect(runAt2.getTime()).toBeLessThan(runAt6.getTime());
  });
});

describe('armTaskAsyncJobs 带 slaOverride（双排程回归，锁「工时选择不生效」）', () => {
  function makeExec() {
    const executor: any = {
      update: () => ({
        set: () => ({ where: () => undefined }),
      }),
    };
    return { executor };
  }
  const wallclockTimeout = {
    enabled: true, timeoutMode: 'wallclock', duration: 4, unit: 'hours',
    wallclockOptions: [{ key: 'w-fast', label: '快', duration: 2, unit: 'hours' }, { key: 'w-slow', label: '慢', duration: 8, unit: 'hours' }],
  };
  const smartTimeout = {
    enabled: true, timeoutMode: 'smart',
    smartSla: { enabled: true, duration: 4, unit: 'hours', calendarId: 1, options: [{ key: 's-fast', duration: 2, unit: 'hours' }, { key: 's-slow', duration: 8, unit: 'hours' }] },
  };

  it('墙钟 override：仅排一次 task_timeout，runAt 按 override(8h) 而非默认(4h)', async () => {
    mockedLoad.mockResolvedValue(null);
    mockedEnqueue.mockClear();
    const { executor } = makeExec();
    const task: any = { id: 5, nodeKey: 'target', nodeType: 'approve', status: 'pending' };
    const inst: any = { id: 100, flowData: makeFlowData(wallclockTimeout), formData: {}, tenantId: null };
    await armTaskAsyncJobs(task, inst, executor, { duration: 8, unit: 'hours' });
    // 修复前：先排「默认 4h」、再补「override 8h」两次 enqueue；第二次被相同 idempotencyKey
    // 幂等拦截 → job.runAt 锁死 4h（即「选 8 小时却按 4 小时算」根因）。
    // 修复后：armTaskAsyncJobs 内部一次性带 override 排程，仅 1 次 enqueue 且 runAt 为 8h。
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    const call = mockedEnqueue.mock.calls[0][0] as any;
    expect(call.jobType).toBe('task_timeout');
    expect(call.runAt.getTime()).toBeCloseTo(Date.now() + 8 * 3600 * 1000, -2);
  });

  it('智能 override：runAt 按日历口径的 override(8h) 计算，晚于默认(4h)', async () => {
    mockedLoad.mockResolvedValue(CAL as any);
    mockedEnqueue.mockClear();
    const { executor } = makeExec();
    const task: any = { id: 6, nodeKey: 'target', nodeType: 'approve', status: 'pending' };
    const inst: any = { id: 100, flowData: makeFlowData(smartTimeout), formData: {}, tenantId: null };
    await armTaskAsyncJobs(task, inst, executor, { duration: 8, unit: 'hours' });
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    const d8 = (mockedEnqueue.mock.calls[0][0] as any).runAt as Date;
    const def = makeExec();
    await armTaskAsyncJobs({ id: 6, nodeKey: 'target', nodeType: 'approve', status: 'pending' } as any, { id: 100, flowData: makeFlowData(smartTimeout), formData: {}, tenantId: null } as any, def.executor, { duration: 4, unit: 'hours' });
    const d4 = (mockedEnqueue.mock.calls[1][0] as any).runAt as Date;
    expect(d8.getTime()).toBeGreaterThan(d4.getTime());
  });
});
