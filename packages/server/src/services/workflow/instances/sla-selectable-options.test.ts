/**
 * listTaskSelectableNextSlaOptions 单测（mock DB / 上下文）。
 * 验证「通过」弹窗的工时选择候选过滤：
 *  - 仅紧邻下游、assigneeType=approverSelect 且 slaSelectionMode='multiple' 且选项非空的节点入列；
 *  - single / 选项为空 的下游节点被排除；
 *  - 权限（非本人且未处理 → 404）、非 pending → 空数组。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ db: { select: vi.fn() } }));
vi.mock('../../../lib/context', () => ({ currentUser: vi.fn() }));
vi.mock('./transfers', () => ({ hasUserHandledTask: vi.fn() }));

import { db } from '../../../db';
import { currentUser } from '../../../lib/context';
import { hasUserHandledTask } from './transfers';
import { listTaskSelectableNextSlaOptions } from './task-actions';
import type { WorkflowFlowData } from '@zenith/shared/workflow';

const mockedUser = vi.mocked(currentUser);
const mockedHandled = vi.mocked(hasUserHandledTask);
const mockedSelect = vi.mocked(db.select);

function chain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

const flowData = {
  nodes: [
    { id: 'n-start', data: { key: 'startNode', type: 'approve', assigneeType: 'user', label: '当前' } },
    {
      id: 'n-d1',
      data: {
        key: 'down1', type: 'approve', assigneeType: 'approverSelect', label: '下游多选',
        timeout: {
          enabled: true, timeoutMode: 'wallclock', duration: 6, unit: 'hours',
          slaSelectionMode: 'multiple',
          wallclockOptions: [{ key: 'a', label: 'A档', duration: 2, unit: 'hours' }],
        },
      },
    },
    {
      id: 'n-d2',
      data: {
        key: 'down2', type: 'approve', assigneeType: 'approverSelect', label: '下游单选',
        timeout: {
          enabled: true, timeoutMode: 'wallclock', duration: 6, unit: 'hours',
          slaSelectionMode: 'single',
          wallclockOptions: [{ key: 'b', label: 'B档', duration: 1, unit: 'days' }],
        },
      },
    },
    {
      id: 'n-d3',
      data: {
        key: 'down3', type: 'approve', assigneeType: 'approverSelect', label: '下游多选但无选项',
        timeout: {
          enabled: true, timeoutMode: 'wallclock', duration: 6, unit: 'hours',
          slaSelectionMode: 'multiple',
          wallclockOptions: [],
        },
      },
    },
  ],
  edges: [
    { source: 'n-start', target: 'n-d1' },
    { source: 'n-start', target: 'n-d2' },
    { source: 'n-start', target: 'n-d3' },
  ],
} as unknown as WorkflowFlowData;

const taskRow = { id: 1, nodeKey: 'startNode', assigneeId: 7, originalAssigneeId: null, delegatedFromId: null, status: 'pending', instanceId: 100 };
const instRow = { id: 100, definitionSnapshot: { flowData } };

beforeEach(() => {
  mockedSelect.mockReset();
  mockedUser.mockReset();
  mockedHandled.mockReset();
  mockedHandled.mockResolvedValue(false);
});

function mockDbForTask() {
  mockedSelect
    .mockImplementationOnce(() => chain([taskRow]))
    .mockImplementationOnce(() => chain([instRow]));
}

describe('listTaskSelectableNextSlaOptions 过滤', () => {
  it('仅 multiple+有选项 的下游节点入列，single / 空选项被排除', async () => {
    mockedUser.mockReturnValue({ userId: 7 } as any);
    mockDbForTask();

    const groups = await listTaskSelectableNextSlaOptions(1);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      nodeKey: 'down1',
      label: '下游多选',
      mode: 'wallclock',
      options: [{ key: 'a', label: 'A档' }],
    });
  });

  it('下游全是 single → 返回空数组', async () => {
    mockedUser.mockReturnValue({ userId: 7 } as any);
    const singleOnly = {
      ...(flowData as any),
      nodes: (flowData as any).nodes.filter((n: any) => n.data.key !== 'down1' && n.data.key !== 'down3'),
    } as unknown as WorkflowFlowData;
    mockedSelect
      .mockImplementationOnce(() => chain([taskRow]))
      .mockImplementationOnce(() => chain([{ ...instRow, definitionSnapshot: { flowData: singleOnly } }]));

    const groups = await listTaskSelectableNextSlaOptions(1);
    expect(groups).toEqual([]);
  });

  it('非本人且未处理过 → 抛 404（任务不存在或无权操作）', async () => {
    mockedUser.mockReturnValue({ userId: 2 } as any); // 不等于 assigneeId=7
    mockDbForTask();

    await expect(listTaskSelectableNextSlaOptions(1)).rejects.toThrow('无权操作');
  });

  it('任务非 pending → 返回空数组', async () => {
    mockedUser.mockReturnValue({ userId: 7 } as any);
    mockedSelect
      .mockImplementationOnce(() => chain([{ ...taskRow, status: 'approved' }]))
      .mockImplementationOnce(() => chain([instRow]));

    const groups = await listTaskSelectableNextSlaOptions(1);
    expect(groups).toEqual([]);
  });

  it('smart 模式节点 mode 标记为 smart 并返回选项 key/label', async () => {
    mockedUser.mockReturnValue({ userId: 7 } as any);
    const smartFlow = {
      ...(flowData as any),
      nodes: [
        (flowData as any).nodes[0],
        {
          id: 'n-ds', data: {
            key: 'downS', type: 'approve', assigneeType: 'approverSelect', label: '智能下游',
            timeout: {
              enabled: true, timeoutMode: 'smart',
              smartSla: { enabled: true, duration: 4, unit: 'hours', calendarId: 1,
                options: [{ key: 's1', label: '智能档', duration: 3, unit: 'workdays' }] },
              slaSelectionMode: 'multiple',
            },
          },
        },
      ],
      edges: [{ source: 'n-start', target: 'n-ds' }],
    } as unknown as WorkflowFlowData;
    mockedSelect
      .mockImplementationOnce(() => chain([taskRow]))
      .mockImplementationOnce(() => chain([{ ...instRow, definitionSnapshot: { flowData: smartFlow } }]));

    const groups = await listTaskSelectableNextSlaOptions(1);
    expect(groups).toHaveLength(1);
    expect(groups[0].mode).toBe('smart');
    expect(groups[0].options).toEqual([{ key: 's1', label: '智能档' }]);
  });
});
