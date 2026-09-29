import { Tag, Tooltip } from '@douyinfe/semi-ui';
import type { WorkflowSlaLevel } from '@zenith/shared/workflow';

interface Props {
  level?: WorkflowSlaLevel;
  overdueSec?: number | null;
  deadline?: string | null;
}

/** 秒数 → 人类可读时长（向上取整到分钟/小时/天） */
function humanizeSec(sec: number): string {
  const s = Math.abs(sec);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} 分钟`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时`;
  return `${Math.round(s / 86400)} 天`;
}

/** 待办 SLA 标签：未配置→灰、充裕→绿、临近→橙、已超时→红 */
export default function WorkflowSLATag({ level, overdueSec, deadline }: Props) {
  // L3：挂起态必须排在 overdueSec==null 拦截之前，否则会被拦成"—"
  if (level === 'suspended') {
    return <Tooltip content="SLA 已挂起，计时暂停"><Tag size="small" color="grey">已挂起</Tag></Tooltip>;
  }
  if (!level || level === 'none' || overdueSec == null) {
    return <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>;
  }
  const tip = deadline ? `截止 ${deadline}` : undefined;
  let color: 'green' | 'orange' | 'red';
  let text: string;
  if (level === 'overdue') {
    color = 'red';
    text = `已超时 ${humanizeSec(overdueSec)}`;
  } else if (level === 'warning') {
    color = 'orange';
    text = `即将超时（剩 ${humanizeSec(overdueSec)}）`;
  } else {
    color = 'green';
    text = `剩 ${humanizeSec(overdueSec)}`;
  }
  const tag = <Tag size="small" color={color}>{text}</Tag>;
  return tip ? <Tooltip content={tip}>{tag}</Tooltip> : tag;
}
