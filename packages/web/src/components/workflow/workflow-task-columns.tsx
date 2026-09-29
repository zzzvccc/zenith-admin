/**
 * 工作流任务表格公共列工厂 —— 任务级表格（流程监控·任务监控 Tab / 实例诊断·任务 Tab）共用。
 *
 * 与 utils/table-columns.tsx 同一思路：按列复用而非合并整表——两处表格的筛选、
 * 分页与操作列职责不同，强行单组件会导致 props 爆炸；公共性收敛在「列渲染语义」上：
 * 节点名（fallback nodeKey）、节点类型标签、任务状态 Tag、处理人（头像+昵称）、停留时长。
 */
import { Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import { UserAvatar } from '@/components/UserAvatar';
import { TASK_STATUS_MAP } from '@/components/workflow/workflow-runtime';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

/** 节点类型 → 中文标签（含网关 / 结构节点，任务表格与节点配置摘要共用） */
export const WORKFLOW_NODE_TYPE_LABEL: Record<string, string> = {
  start: '发起',
  approve: '审批',
  handler: '办理',
  end: '结束',
  exclusiveGateway: '条件分支',
  parallelGateway: '并行分支',
  inclusiveGateway: '包容分支',
  routeGateway: '路由分支',
  ccNode: '抄送',
  delay: '延迟',
  trigger: '触发器',
  subProcess: '子流程',
  catchNode: '捕获',
  slaApprove: 'SLA 审批',
};

/** 会生成任务行的节点类型筛选项（任务监控筛选用） */
export const WORKFLOW_TASK_NODE_TYPE_OPTIONS = [
  { value: 'approve', label: WORKFLOW_NODE_TYPE_LABEL.approve },
  { value: 'handler', label: WORKFLOW_NODE_TYPE_LABEL.handler },
  { value: 'ccNode', label: WORKFLOW_NODE_TYPE_LABEL.ccNode },
  { value: 'delay', label: WORKFLOW_NODE_TYPE_LABEL.delay },
  { value: 'trigger', label: WORKFLOW_NODE_TYPE_LABEL.trigger },
  { value: 'subProcess', label: WORKFLOW_NODE_TYPE_LABEL.subProcess },
];

/** 任务行公共字段（诊断 WorkflowTask 与监控 WorkflowTaskMonitorItem 的交集） */
interface TaskRowLike extends Data {
  id?: number;
  nodeKey?: string;
  nodeName?: string;
  nodeType?: string | null;
  status?: string;
  assigneeId?: number | null;
  assigneeName?: string | null;
  assigneeAvatar?: string | null;
  comment?: string | null;
  /** 服务端派生的意见来源（缺失时由 deriveTaskCommentSource 前端兜底） */
  commentSource?: 'user' | 'system' | null;
  createdAt?: string;
  actionAt?: string | null;
  /** 服务端派生的停留秒数（缺失时由 resolveTaskStayedSec 前端兜底） */
  stayedSec?: number | null;
}

/**
 * 处理意见来源判定（与服务端 listAllTasks 同规则）：
 * 非审批/办理节点、skipped 清场留痕、无处理人的自动任务（同人跳过/空审批人自动通过）为系统留痕。
 */
export function deriveTaskCommentSource(row: TaskRowLike): 'user' | 'system' | null {
  if (!row.comment) return null;
  if (row.commentSource) return row.commentSource;
  const systemLike = (row.nodeType !== 'approve' && row.nodeType !== 'handler')
    || row.status === 'skipped'
    || row.assigneeId == null;
  return systemLike ? 'system' : 'user';
}

/** 解析停留/处理秒数：优先服务端 stayedSec；否则终态用 actionAt-createdAt，未终态用至今 */
export function resolveTaskStayedSec(row: TaskRowLike): number | null {
  if (row.stayedSec !== undefined) return row.stayedSec;
  if (!row.createdAt) return null;
  const start = new Date(row.createdAt.replace(' ', 'T')).getTime();
  if (Number.isNaN(start)) return null;
  if (row.status === 'pending' || row.status === 'waiting') {
    return Math.max(0, Math.floor((Date.now() - start) / 1000));
  }
  if (!row.actionAt) return null;
  const end = new Date(row.actionAt.replace(' ', 'T')).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / 1000));
}

/** 秒数 → 人类可读停留/处理时长 */
export function formatTaskStayDuration(sec: number | null | undefined): string {
  if (sec == null) return EMPTY_PLACEHOLDER;
  if (sec < 60) return `${sec}秒`;
  const minutes = Math.floor(sec / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时${minutes % 60 > 0 ? `${minutes % 60}分` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days}天${hours % 24 > 0 ? `${hours % 24}小时` : ''}`;
}

/** 任务 ID 列 */
export function taskIdColumn<T extends TaskRowLike>(title = 'ID', width = 70): ColumnProps<T> {
  return { title, dataIndex: 'id', width };
}

/** 节点列：节点名（fallback nodeKey），可附带类型标签 */
export function taskNodeColumn<T extends TaskRowLike>(
  options: { title?: string; width?: number; withTypeTag?: boolean } = {},
): ColumnProps<T> {
  const { title = '节点', width = 160, withTypeTag = false } = options;
  return {
    title,
    dataIndex: 'nodeName',
    width,
    render: (_: unknown, row: T) => {
      const name = row.nodeName || row.nodeKey || EMPTY_PLACEHOLDER;
      if (!withTypeTag || !row.nodeType) return name;
      return (
        <Space spacing={4}>
          <span>{name}</span>
          <Tag size="small" color="grey">{WORKFLOW_NODE_TYPE_LABEL[row.nodeType] ?? row.nodeType}</Tag>
        </Space>
      );
    },
  };
}

/** 节点类型标签列 */
export function taskNodeTypeColumn<T extends TaskRowLike>(title = '类型', width = 100): ColumnProps<T> {
  return {
    title,
    dataIndex: 'nodeType',
    width,
    render: (v: string | null) => (v ? WORKFLOW_NODE_TYPE_LABEL[v] ?? v : EMPTY_PLACEHOLDER),
  };
}

/** 任务状态 Tag 列（文案/配色统一走 TASK_STATUS_MAP） */
export function taskStatusColumn<T extends TaskRowLike>(title = '状态', width = 100): ColumnProps<T> {
  return {
    title,
    dataIndex: 'status',
    width,
    render: (v: string) => {
      const m = TASK_STATUS_MAP[v] ?? { text: v, color: 'grey' as const };
      return <Tag color={m.color}>{m.text}</Tag>;
    },
  };
}

/** 处理人列（头像 + 昵称，空值占位） */
export function taskAssigneeColumn<T extends TaskRowLike>(title = '处理人', width = 130): ColumnProps<T> {
  return {
    title,
    dataIndex: 'assigneeName',
    width,
    render: (v: string | null, row: T) => (v
      ? <Space spacing={6}><UserAvatar name={v} avatar={row.assigneeAvatar} semiSize="extra-extra-small" size={20} /><span>{v}</span></Space>
      : <span style={{ color: 'var(--semi-color-text-2)' }}>{EMPTY_PLACEHOLDER}</span>),
  };
}

/** 处理意见列：系统留痕带「系统」标签并弱化，人工意见正常展示，超宽省略走 Tooltip */
export function taskCommentColumn<T extends TaskRowLike>(title = '处理意见', width = 220): ColumnProps<T> {
  return {
    title,
    dataIndex: 'comment',
    width,
    render: (v: string | null, row: T) => {
      if (!v) return EMPTY_PLACEHOLDER;
      if (deriveTaskCommentSource(row) === 'system') {
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
            <Tag size="small" color="grey" type="light" style={{ flexShrink: 0 }}>系统</Tag>
            <Typography.Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ flex: 1, minWidth: 0 }}>{v}</Typography.Text>
          </div>
        );
      }
      return (
        <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v}</Typography.Text>
      );
    },
  };
}

/** 耗时列：未终态停留超 24h 标红提示积压 */
export function taskStayDurationColumn<T extends TaskRowLike>(title = '耗时', width = 110): ColumnProps<T> {
  return {
    title,
    dataIndex: 'stayedSec',
    width,
    align: 'right',
    render: (_: unknown, row: T) => {
      const sec = resolveTaskStayedSec(row);
      const overdue = (row.status === 'pending' || row.status === 'waiting') && sec != null && sec > 86_400;
      return (
        <span style={{ color: overdue ? 'var(--semi-color-danger)' : 'var(--semi-color-text-1)' }}>
          {formatTaskStayDuration(sec)}
        </span>
      );
    },
  };
}
