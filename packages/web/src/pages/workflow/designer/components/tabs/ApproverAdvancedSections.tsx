/**
 * 审批人节点 — 高级分区（带摘要的折叠面板）
 *
 * 不自带外层 fd-drawer-tab-content 包裹，直接内联在「审批人」面板里随主配置一起滚动。
 * 分区：审批人拒绝时 / 审批人超时未处理时 / 审批人为空时 / 审批人与提交人为同一人时 / 审批人去重。
 * 默认全部收起，面板头常驻当前策略摘要（收起 ≠ 隐藏信息）；偏离默认值的面板以「已配置」标签标记；
 * 配置不完整（如退回目标节点未选）的面板初始自动展开，避免必填项被折叠遮蔽。
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Button, Collapse, Form, Input, InputNumber, Radio, RadioGroup, Select, Switch, Tag, Typography } from '@douyinfe/semi-ui';
import { Minus, Plus } from 'lucide-react';
import type {
  RejectStrategy,
  EmptyAssigneeStrategy,
  TimeoutConfig,
  SameInitiatorStrategy,
  DeduplicateStrategy,
} from '../../types';
import {
  AUTO_DECISION_LABELS,
  REJECT_STRATEGY_OPTIONS,
  EMPTY_ASSIGNEE_OPTIONS,
  SAME_INITIATOR_OPTIONS,
  DEDUPLICATE_OPTIONS,
} from '../../constants';
import type { WorkflowCustomDuration } from '@zenith/shared/workflow';
import { useWorkCalendarOptions } from '@/hooks/queries/workflow-calendars';

interface UserOption { id: number; nickname: string; }

interface ApproverAdvancedSectionsProps {
  rejectStrategy: RejectStrategy;
  rejectToNodeKey?: string;
  availableRejectNodes?: Array<{ id: string; key?: string; name: string; type: string }>;
  emptyStrategy: EmptyAssigneeStrategy;
  emptyAssignToIds?: number[];
  sameInitiatorStrategy?: SameInitiatorStrategy;
  deduplicateStrategy?: DeduplicateStrategy;
  returnMode?: 'reexecute' | 'backToOrigin';
  catchAction?: 'toAdmin' | 'notify' | 'terminate';
  catchNotifyUserIds?: number[];
  timeout?: TimeoutConfig;
  users: UserOption[];
  onChange: (updates: Record<string, unknown>) => void;
}

/** 折叠面板头：标题 + 当前策略摘要(右侧常驻);偏离默认值时展示「已配置」标签 */
function PanelHeader({ title, summary, modified }: Readonly<{ title: string; summary: string; modified?: boolean }>) {
  return (
    <div className="fd-collapse-head">
      <span className="fd-collapse-head__title">{title}</span>
      {modified && <Tag size="small" color="blue" className="fd-collapse-head__tag">已配置</Tag>}
      <span className="fd-collapse-head__summary">{summary}</span>
    </div>
  );
}

/** 必填星号 */
function ReqLabel({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="fd-field-label">
      <span className="fd-field-label__req">*</span>
      {children}
    </div>
  );
}

/** 横向步进器 −/[n]/+ */
function Stepper({
  value, min, max, onChange,
}: Readonly<{ value: number; min: number; max: number; onChange: (v: number) => void }>) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="fd-stepper">
      <button
        type="button"
        className="fd-stepper__btn"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
        aria-label="减少"
      >
        <Minus size={14} />
      </button>
      <span className="fd-stepper__value">{value}</span>
      <button
        type="button"
        className="fd-stepper__btn"
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
        aria-label="增加"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

export default function ApproverAdvancedSections({
  rejectStrategy,
  rejectToNodeKey,
  availableRejectNodes = [],
  emptyStrategy,
  emptyAssignToIds,
  sameInitiatorStrategy = 'autoSkip',
  deduplicateStrategy = 'autoSkip',
  returnMode = 'reexecute',
  catchAction,
  catchNotifyUserIds,
  timeout,
  users,
  onChange,
}: Readonly<ApproverAdvancedSectionsProps>) {

  const handleTimeoutChange = (updates: Partial<TimeoutConfig>) => {
    onChange({
      timeout: {
        enabled: false,
        duration: 6,
        unit: 'hours',
        action: 'remind',
        remindCount: 1,
        ...timeout,
        ...updates,
      },
    });
  };

  const WALLCLOCK_UNIT_CHOICES = [
    { value: 'minutes' as const, label: '分钟' },
    { value: 'hours' as const, label: '小时' },
    { value: 'days' as const, label: '天' },
  ];
  const SMART_UNIT_CHOICES = [
    ...WALLCLOCK_UNIT_CHOICES,
    { value: 'workdays' as const, label: '工作日' },
  ];

  const timeoutEnabled = timeout?.enabled ?? false;
  const timeoutAction = timeout?.action ?? 'remind';
  /** 计时模式：wallclock=官方墙钟；smart=智能 SLA（只在工作日历工作时段计时） */
  const timeoutMode = timeout?.timeoutMode ?? 'wallclock';
  const smartSla = timeout?.smartSla;
  const calendarOptionsQuery = useWorkCalendarOptions(timeoutMode === 'smart');
  const calendarOptions = useMemo(
    () => (calendarOptionsQuery.data ?? []).map((c) => ({ value: c.id, label: `${c.name}（${c.timezone}）` })),
    [calendarOptionsQuery.data],
  );

  const handleSmartSlaChange = (updates: Partial<NonNullable<TimeoutConfig['smartSla']>>) => {
    handleTimeoutChange({
      smartSla: {
        enabled: true,
        duration: 8,
        unit: 'hours',
        calendarId: calendarOptions[0]?.value ?? 0,
        allowDelay: false,
        allowSuspend: false,
        requireSlaApproval: false,
        slaApprovers: [],
        maxDelayCount: 0,
        maxSuspendCount: 0,
        ...smartSla,
        ...updates,
      },
    });
  };

  /** 渲染「自定义时限」数组编辑器：增删条目、标默认；默认项同步回单值 duration/unit（保证列表 SLA 计算不破） */
  const renderCustomDurationEditor = (
    options: WorkflowCustomDuration[] | undefined,
    onChange: (next: WorkflowCustomDuration[]) => void,
    unitChoices: ReadonlyArray<{ value: WorkflowCustomDuration['unit']; label: string }>,
  ) => {
    const list = options ?? [];
    // 单次提交：由调用处把「数组 + 默认项单值」合并进同一个 timeout patch，
    // 避免分两次 handleTimeoutChange 基于旧闭包相互覆盖（会丢 wallclockOptions）。
    const commit = (next: WorkflowCustomDuration[]) => {
      onChange(next);
    };
    const updateAt = (idx: number, patch: Partial<WorkflowCustomDuration>) =>
      commit(list.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
    const removeAt = (idx: number) => commit(list.filter((_, i) => i !== idx));
    const addOne = () =>
      commit([...list, { key: `opt_${Date.now()}_${list.length}`, label: '', duration: 1, unit: unitChoices[0].value, isDefault: list.length === 0 }]);
    const makeDefault = (idx: number) =>
      commit(list.map((o, i) => ({ ...o, isDefault: i === idx })));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.length === 0 && (
          <Typography.Text type="tertiary" size="small">暂无自定义时限，点击下方按钮添加。</Typography.Text>
        )}
        {list.map((o, idx) => (
          <div key={o.key} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Input
              value={o.label}
              onChange={(v: string) => updateAt(idx, { label: v })}
              placeholder="显示名，如 4 小时"
              style={{ width: 140 }}
            />
            <InputNumber
              value={o.duration}
              onChange={(v: number | string) => updateAt(idx, { duration: Number(v) || 1 })}
              min={1}
              max={9999}
              style={{ width: 90 }}
            />
            <Select
              value={o.unit}
              onChange={(v: unknown) => updateAt(idx, { unit: v as WorkflowCustomDuration['unit'] })}
              style={{ width: 100 }}
              optionList={unitChoices as unknown as Array<{ value: string; label: string }>}
            />
            <Radio checked={!!o.isDefault} onChange={() => makeDefault(idx)}>默认</Radio>
            <Button theme="borderless" type="danger" icon={<Minus size={14} />} onClick={() => removeAt(idx)} />
          </div>
        ))}
        <Button theme="light" icon={<Plus size={14} />} onClick={addOne}>新增时限</Button>
      </div>
    );
  };

  // ── 各面板摘要与「偏离默认」判定(收起时头部常驻,信息不因折叠而丢失) ──
  const rejectLabel = REJECT_STRATEGY_OPTIONS.find((o) => o.value === rejectStrategy)?.label ?? rejectStrategy;
  const rejectTargetName = rejectStrategy === 'returnToNode'
    ? availableRejectNodes.find((n) => (n.key || n.id) === rejectToNodeKey)?.name
    : undefined;
  const rejectSummary = rejectStrategy === 'returnToNode'
    ? `${rejectLabel}：${rejectTargetName ?? '未选择节点'}`
    : rejectLabel;
  const rejectModified = rejectStrategy !== 'terminate' || returnMode !== 'reexecute';
  const rejectIncomplete = rejectStrategy === 'returnToNode' && !rejectToNodeKey;

  const TIMEOUT_UNIT_LABELS = { minutes: '分钟', hours: '小时', days: '天' } as const;
  /** 智能 SLA 时限预设：设计器下拉选项；选「自定义」再展开数字 + 单位输入（已迁移为「自定义时限」数组，见 renderCustomDurationEditor） */
  const timeoutActionLabel = timeoutAction === 'remind' ? '自动提醒' : AUTO_DECISION_LABELS[timeoutAction as 'autoApprove' | 'autoReject'];
  const timeoutSummary = timeoutEnabled
    ? `超过 ${timeout?.duration ?? 6} ${TIMEOUT_UNIT_LABELS[timeout?.unit ?? 'hours']}后${timeoutActionLabel}`
    : '未启用';

  const emptyLabel = EMPTY_ASSIGNEE_OPTIONS.find((o) => o.value === emptyStrategy)?.label ?? emptyStrategy;
  const emptySummary = catchAction ? `${emptyLabel} · 异常兜底已启用` : emptyLabel;
  const emptyModified = emptyStrategy !== 'autoApprove' || !!catchAction;
  const emptyIncomplete = emptyStrategy === 'assignTo' && (emptyAssignToIds?.length ?? 0) === 0;

  const sameSummary = SAME_INITIATOR_OPTIONS.find((o) => o.value === sameInitiatorStrategy)?.label ?? sameInitiatorStrategy;
  const dedupSummary = DEDUPLICATE_OPTIONS.find((o) => o.value === deduplicateStrategy)?.label ?? deduplicateStrategy;

  // 默认全部收起;配置不完整的面板初始展开,避免必填项被折叠遮蔽
  const [activeKeys, setActiveKeys] = useState<string[]>(() => {
    const keys: string[] = [];
    if (rejectIncomplete) keys.push('reject');
    if (emptyIncomplete) keys.push('empty');
    return keys;
  });

  return (
    <>
      <Typography.Title heading={6} style={{ margin: '20px 0 10px' }}>兜底策略</Typography.Title>
      <Collapse
        className="fd-advanced-collapse"
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys as string[] : [keys as string])}
        keepDOM
      >
      {/* ─── 审批人拒绝时 ─────────────────────────────────────── */}
      <Collapse.Panel itemKey="reject" header={<PanelHeader title="审批人拒绝时" summary={rejectSummary} modified={rejectModified} />}>
      <RadioGroup
        value={rejectStrategy}
        onChange={(e) => onChange({ rejectStrategy: e.target.value })}
        direction="vertical"
        className="fd-radio-list"
      >
        {REJECT_STRATEGY_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>{o.label}</Radio>
        ))}
      </RadioGroup>
      {rejectStrategy === 'returnToNode' && (
        <div style={{ marginTop: 4, marginBottom: 8 }}>
          <ReqLabel>驳回节点</ReqLabel>
          <Select
            value={rejectToNodeKey}
            onChange={(v) => onChange({ rejectToNodeKey: v })}
            style={{ width: '100%' }}
            placeholder={availableRejectNodes.length === 0 ? '当前节点之前没有可选节点' : '请选择'}
            disabled={availableRejectNodes.length === 0}
            optionList={availableRejectNodes.map((n) => ({
              value: n.key || n.id,
              label: `${n.name}（${n.type === 'approver' ? '审批人' : '办理人'}${n.key ? ` · ${n.key}` : ''}）`,
            }))}
          />
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
            仅能选当前节点之前同一执行路径上的审批、办理节点
          </Typography.Text>
        </div>
      )}
      {(rejectStrategy === 'returnPrev' || rejectStrategy === 'returnToNode') && (
        <div style={{ marginTop: 4, marginBottom: 8 }}>
          <div className="fd-field-label">退回后</div>
          <RadioGroup
            value={returnMode}
            onChange={(e) => onChange({ returnMode: e.target.value })}
            direction="vertical"
            className="fd-radio-list"
          >
            <Radio value="reexecute">重新执行后续路径（默认）</Radio>
            <Radio value="backToOrigin">去而复返（被退回节点通过后直接回到本节点）</Radio>
          </RadioGroup>
        </div>
      )}
      </Collapse.Panel>

      {/* ─── 审批人超时未处理时 ───────────────────────────────── */}
      <Collapse.Panel itemKey="timeout" header={<PanelHeader title="超时未处理" summary={timeoutSummary} modified={timeoutEnabled} />}>
      <ReqLabel>启用开关</ReqLabel>
      <div className="fd-switch-row">
        <span className={`fd-switch-row__txt ${!timeoutEnabled ? 'fd-switch-row__txt--active' : ''}`}>关闭</span>
        <Switch checked={timeoutEnabled} onChange={(v) => handleTimeoutChange({ enabled: v })} />
        <span className={`fd-switch-row__txt ${timeoutEnabled ? 'fd-switch-row__txt--active' : ''}`}>开启</span>
      </div>

      {timeoutEnabled && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ─── 工时选择模式：单选（不弹窗）/ 多选（通过弹窗选） ─── */}
          <div>
            <ReqLabel>工时选择模式</ReqLabel>
            <RadioGroup
              type="button"
              value={timeout?.slaSelectionMode ?? 'single'}
              onChange={(e) => handleTimeoutChange({ slaSelectionMode: e.target.value as NonNullable<TimeoutConfig['slaSelectionMode']> })}
              className="fd-segmented-full"
            >
              <Radio value="single">单选（通过不弹窗，用默认项）</Radio>
              <Radio value="multiple">多选（通过弹窗必选）</Radio>
            </RadioGroup>
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
              多选时，上游审批人「通过」本节点时需为下一节点挑选时限；单选直接采用下方默认项。
            </Typography.Text>
          </div>

          {/* ─── 计时方式：墙钟 / 智能 SLA 二选一，明确当前生效口径 ─── */}
          <div>
            <ReqLabel>计时方式</ReqLabel>
            <RadioGroup
              type="button"
              value={timeoutMode}
              onChange={(e) => {
                const next = e.target.value as 'wallclock' | 'smart';
                if (next === 'smart') {
                  handleTimeoutChange({
                    timeoutMode: 'smart',
                    smartSla: {
                      enabled: true,
                      duration: smartSla?.duration ?? 8,
                      unit: smartSla?.unit ?? 'hours',
                      calendarId: smartSla?.calendarId ?? (calendarOptions[0]?.value ?? 0),
                      allowDelay: smartSla?.allowDelay ?? false,
                      allowSuspend: smartSla?.allowSuspend ?? false,
                      requireSlaApproval: smartSla?.requireSlaApproval ?? false,
                      slaApprovers: smartSla?.slaApprovers ?? [],
                      maxDelayCount: smartSla?.maxDelayCount ?? 0,
                      maxSuspendCount: smartSla?.maxSuspendCount ?? 0,
                    },
                  });
                } else {
                  handleTimeoutChange({ timeoutMode: 'wallclock' });
                }
              }}
              className="fd-segmented-full"
            >
              <Radio value="wallclock">墙钟模式（自然计时）</Radio>
              <Radio value="smart">智能 SLA 模式（按工作日历）</Radio>
            </RadioGroup>
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
              {timeoutMode === 'smart'
                ? '按工作日历工作时段计时，跳过周末 / 节假日 / 午休；日历不可用时自动降级为墙钟自然计时（默认 6 小时）。'
                : '以自然时间连续计时（如超过 6 小时未处理即触发）。'}
            </Typography.Text>
          </div>

          <div>
            <ReqLabel>执行动作</ReqLabel>
            <RadioGroup
              type="button"
              value={timeoutAction}
              onChange={(e) => handleTimeoutChange({ action: e.target.value as TimeoutConfig['action'] })}
              className="fd-segmented-full"
            >
              <Radio value="remind">自动提醒</Radio>
              <Radio value="autoApprove">{AUTO_DECISION_LABELS.autoApprove}</Radio>
              <Radio value="autoReject">{AUTO_DECISION_LABELS.autoReject}</Radio>
            </RadioGroup>
          </div>

          {timeoutMode === 'wallclock' && (
            <div>
              <Typography.Text size="small" style={{ display: 'block', marginBottom: 8, color: 'var(--semi-color-text-1)' }}>
                自定义时限（自然计时）
              </Typography.Text>
              {renderCustomDurationEditor(
                timeout?.wallclockOptions,
                (next) => {
                  const def = next.find((o) => o.isDefault) ?? next[0];
                  handleTimeoutChange({
                    wallclockOptions: next,
                    duration: def?.duration ?? 1,
                    unit: (def?.unit ?? 'hours') as TimeoutConfig['unit'],
                  });
                },
                WALLCLOCK_UNIT_CHOICES,
              )}
            </div>
          )}

          {timeoutAction === 'remind' && (
            <div>
              <ReqLabel>最大提醒次数</ReqLabel>
              <Stepper
                value={timeout?.remindCount ?? 1}
                min={1}
                max={10}
                onChange={(v) => handleTimeoutChange({ remindCount: v })}
              />
            </div>
          )}

          {timeoutAction === 'remind' && (
            <div>
              <Typography.Text size="small" style={{ display: 'block', marginBottom: 8, color: 'var(--semi-color-text-1)' }}>
                提醒耗尽后
              </Typography.Text>
              <Select
                value={timeout?.escalateAction ?? 'none'}
                onChange={(v) => handleTimeoutChange({ escalateAction: v as TimeoutConfig['escalateAction'] })}
                style={{ width: '100%' }}
                optionList={[
                  { value: 'none', label: '不处理（保持挂起，等待人工）' },
                  { value: 'autoApprove', label: AUTO_DECISION_LABELS.autoApprove },
                  { value: 'autoReject', label: AUTO_DECISION_LABELS.autoReject },
                  { value: 'transferToManager', label: '转交给上级处理' },
                ]}
              />
              {timeout?.escalateAction === 'transferToManager' && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>上级层级</span>
                    <InputNumber
                      value={timeout?.escalateManagerLevel ?? 1}
                      onChange={(v) => handleTimeoutChange({ escalateManagerLevel: Number(v) || 1 })}
                      min={1}
                      max={10}
                      style={{ width: 110 }}
                      suffix="级"
                    />
                    <Typography.Text type="tertiary" size="small">1 = 直属上级</Typography.Text>
                  </div>
                  <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
                    找不到指定上级时会依次尝试部门负责人、系统管理员。
                  </Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <div className="fd-field-label">仍无人可转时</div>
                    <Select
                      value={timeout?.escalateFallbackAction ?? 'none'}
                      onChange={(v) => handleTimeoutChange({ escalateFallbackAction: v as TimeoutConfig['escalateFallbackAction'] })}
                      style={{ width: '100%' }}
                      optionList={[
                        { value: 'none', label: '保持挂起（停止重复扫描）' },
                        { value: 'autoApprove', label: AUTO_DECISION_LABELS.autoApprove },
                        { value: 'autoReject', label: AUTO_DECISION_LABELS.autoReject },
                      ]}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {timeoutMode === 'smart' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}>
              <div className="fd-field-label">智能 SLA 自定义时限</div>
              {renderCustomDurationEditor(
                smartSla?.options,
                (next) => {
                  const def = next.find((o) => o.isDefault) ?? next[0];
                  handleSmartSlaChange({
                    options: next,
                    duration: def?.duration ?? 8,
                    unit: (def?.unit ?? 'hours') as NonNullable<TimeoutConfig['smartSla']>['unit'],
                  });
                },
                SMART_UNIT_CHOICES,
              )}
              <div>
                <div className="fd-field-label">工作日历</div>
                <Select
                  value={smartSla?.calendarId ?? (calendarOptions[0]?.value ?? 0)}
                  onChange={(v) => handleSmartSlaChange({ calendarId: Number(v) })}
                  style={{ width: '100%' }}
                  optionList={calendarOptions}
                  emptyContent="暂无可用日历，请先在「工作日历」中新建"
                />
                <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
                  工作日按 0=周日…6=周六 存储；1 个工作日 = 日历每日工时之和。
                </Typography.Text>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>允许处理人申请延时</span>
                  <Switch checked={smartSla?.allowDelay ?? false} onChange={(v) => handleSmartSlaChange({ allowDelay: v })} />
                </div>
                {(smartSla?.allowDelay ?? false) && (
                  <div className="fd-timeout-inline">
                    <span>最多延时</span>
                    <InputNumber
                      value={smartSla?.maxDelayCount ?? 1}
                      onChange={(v) => handleSmartSlaChange({ maxDelayCount: Number(v) || 0 })}
                      min={0}
                      max={99}
                      style={{ width: 100 }}
                    />
                    <span>次（0 = 不限）</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>允许处理人申请挂起</span>
                  <Switch checked={smartSla?.allowSuspend ?? false} onChange={(v) => handleSmartSlaChange({ allowSuspend: v })} />
                </div>
                {(smartSla?.allowSuspend ?? false) && (
                  <div className="fd-timeout-inline">
                    <span>最多挂起</span>
                    <InputNumber
                      value={smartSla?.maxSuspendCount ?? 1}
                      onChange={(v) => handleSmartSlaChange({ maxSuspendCount: Number(v) || 0 })}
                      min={0}
                      max={99}
                      style={{ width: 100 }}
                    />
                    <span>次（0 = 不限）</span>
                  </div>
                )}
              </div>
              {(smartSla?.allowDelay || smartSla?.allowSuspend) && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>申请需 SLA 审批人审批</span>
                  <Switch checked={smartSla?.requireSlaApproval ?? false} onChange={(v) => handleSmartSlaChange({ requireSlaApproval: v })} />
                </div>
              )}
              {(smartSla?.requireSlaApproval ?? false) && (
                <div>
                  <div className="fd-field-label">SLA 审批人（支持多选，会签策略跟随本节点）</div>
                  <Select
                    multiple
                    value={(smartSla?.slaApprovers ?? []).flatMap((a) => a.userIds ?? [])}
                    onChange={(v) => handleSmartSlaChange({
                      slaApprovers: (v as number[]).length > 0
                        ? [{ assigneeType: 'user' as const, userIds: v as number[] }]
                        : [],
                    })}
                    style={{ width: '100%' }}
                    optionList={users.map((u) => ({ value: u.id, label: u.nickname }))}
                    emptyContent="暂无可选用户"
                  />
                  <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
                    审批通过后才会真正改动时钟；不配置审批人则申请直接生效。
                  </Typography.Text>
                </div>
              )}
            </div>
          )}

        </div>
      )}
      </Collapse.Panel>

      {/* ─── 审批人为空时 ─────────────────────────────────────── */}
      <Collapse.Panel itemKey="empty" header={<PanelHeader title="审批人为空时" summary={emptySummary} modified={emptyModified} />}>
      <RadioGroup
        value={emptyStrategy}
        onChange={(e) => onChange({ emptyStrategy: e.target.value })}
        direction="vertical"
        className="fd-radio-list"
      >
        {EMPTY_ASSIGNEE_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>{o.label}</Radio>
        ))}
      </RadioGroup>
      {emptyStrategy === 'assignTo' && (
        <div style={{ marginTop: 4, marginBottom: 8 }}>
          <Form.Slot label="转交给（可多选，多人时生成会签任务）">
            <Select
              value={emptyAssignToIds ?? []}
              onChange={(v) => {
                const ids = Array.isArray(v) ? (v as number[]) : [];
                const names = ids.map((id) => users.find((u) => u.id === id)?.nickname ?? '').filter(Boolean);
                onChange({
                  emptyAssignToIds: ids,
                  emptyAssignToNames: names,
                });
              }}
              multiple
              filter
              style={{ width: '100%' }}
              placeholder="请选择转交人员"
              optionList={users.map((u) => ({ value: u.id, label: u.nickname }))}
            />
          </Form.Slot>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <div className="fd-field-label">异常兜底（审批人为空时的额外处理）</div>
        <Select
          value={catchAction ?? ''}
          onChange={(v) => onChange({ catchAction: v === '' ? undefined : v })}
          style={{ width: '100%' }}
          placeholder="不启用（按上方策略处理）"
          optionList={[
            { value: '', label: '不启用（按上方策略处理）' },
            { value: 'toAdmin', label: '转交管理员处理' },
            { value: 'notify', label: '通知相关人并自动通过' },
            { value: 'terminate', label: '终止流程' },
          ]}
        />
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
          启用后，当审批人解析为空时优先执行此异常处理。
        </Typography.Text>
        {catchAction === 'notify' && (
          <div style={{ marginTop: 8 }}>
            <div className="fd-field-label">通知人</div>
            <Select
              multiple
              filter
              style={{ width: '100%' }}
              placeholder="请选择异常通知人"
              value={catchNotifyUserIds ?? []}
              onChange={(v) => onChange({ catchNotifyUserIds: (v as number[]) ?? [] })}
              optionList={users.map((u) => ({ value: u.id, label: u.nickname }))}
            />
          </div>
        )}
      </div>
      </Collapse.Panel>

      {/* ─── 审批人与提交人为同一人时 ─────────────────────────── */}
      <Collapse.Panel itemKey="sameInitiator" header={<PanelHeader title="与提交人同一人" summary={sameSummary} modified={sameInitiatorStrategy !== 'autoSkip'} />}>
      <RadioGroup
        value={sameInitiatorStrategy}
        onChange={(e) => onChange({ sameInitiatorStrategy: e.target.value })}
        direction="vertical"
        className="fd-radio-list"
      >
        {SAME_INITIATOR_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>{o.label}</Radio>
        ))}
      </RadioGroup>
      </Collapse.Panel>

      {/* ─── 审批人去重 ───────────────────────────────────────── */}
      <Collapse.Panel itemKey="dedup" header={<PanelHeader title="审批人去重" summary={dedupSummary} modified={deduplicateStrategy !== 'autoSkip'} />}>
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
        当同一审批人出现在多个审批节点时的处理方式
      </Typography.Text>
      <Select
        value={deduplicateStrategy}
        onChange={(v) => onChange({ deduplicateStrategy: v })}
        style={{ width: '100%' }}
        optionList={DEDUPLICATE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        placeholder="请选择去重策略"
      />
      </Collapse.Panel>
      </Collapse>
    </>
  );
}
