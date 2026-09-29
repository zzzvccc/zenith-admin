import { useMemo, useState } from 'react';
import { Button, Col, Form, Input, Row, Select, Table, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { workCalendarContract, type WorkCalendar, type WorkflowCalendarHoliday } from '@zenith/shared/workflow';
import {
  useDeleteWorkCalendars, useSaveWorkCalendar, useWorkCalendarList,
  useCalendarHolidays, useCreateCalendarHoliday, useDeleteCalendarHoliday,
} from '@/hooks/queries/workflow-calendars';
import { CreateButton } from '@/components/toolbar-controls';
import { ListSearchToolbar, useStatusToggle, useCrudOperationColumn } from '@/components/list-page';
import { useEditModal } from '@/hooks/useEditModal';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';
import { useDictItems } from '@/hooks/useDictItems';

interface CalendarFormValues {
  name: string;
  timezone: string;
  workdays: number[];
  hoursText: string;
  status: 'enabled' | 'disabled';
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export default function WorkCalendarPage() {
  const { options: statusOptions } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const page = useListPage({
    contract: workCalendarContract,
    useList: useWorkCalendarList,
    table: { empty: '暂无数据' },
  });
  const { tableProps } = page;

  const saveMutation = useSaveWorkCalendar();
  const toggleStatusMutation = useSaveWorkCalendar();
  const deleteMutation = useDeleteWorkCalendars();
  const createHoliday = useCreateCalendarHoliday();
  const deleteHoliday = useDeleteCalendarHoliday();

  // 节假日管理弹窗
  const [holidayCalendar, setHolidayCalendar] = useState<WorkCalendar | null>(null);
  const holidaysQuery = useCalendarHolidays(holidayCalendar?.id, holidayCalendar != null);
  const [holidayForm, setHolidayForm] = useState({ date: '', isWorkday: false, specialHoursText: '' });

  const calendarModal = useEditModal<WorkCalendar, CalendarFormValues, Record<string, unknown>>({
    entityName: '工作日历',
    save: saveMutation,
    defaults: {
      name: '', timezone: 'Asia/Shanghai', workdays: [1, 2, 3, 4, 5],
      hoursText: '09:00-12:00,13:00-18:00', status: 'enabled',
    },
    toValues: (record) => ({
      name: record.name,
      timezone: record.timezone,
      workdays: record.workdays,
      hoursText: record.dailyHours.map((h) => `${h.start}-${h.end}`).join(','),
      status: record.status,
    }),
    beforeSave: (values) => ({
      name: values.name,
      timezone: values.timezone,
      workdays: values.workdays,
      // 多段用逗号分隔：09:00-12:00,13:00-18:00（多段即跳午休）
      dailyHours: values.hoursText.split(',').map((s) => s.trim()).filter(Boolean)
        .map((seg) => ({ start: seg.split('-')[0]?.trim() ?? '09:00', end: seg.split('-')[1]?.trim() ?? '18:00' })),
      status: values.status,
    }),
    labelWidth: 96,
  });

  const status = useStatusToggle<WorkCalendar>({
    toggle: (record, checked) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ title: '确认停用', content: `停用后「${record.name}」不可再被新的 SLA 节点选择，确认停用？` }),
    disabled: !hasPermission('workflow:calendar:update'),
  });

  const operationColumn = useCrudOperationColumn<WorkCalendar>({
    permission: 'workflow:calendar',
    edit: (record) => calendarModal.openEdit(record),
    remove: deleteMutation,
    content: '删除后引用该日历的节点会降级为墙钟计时',
    extra: (record) => [
      { key: 'holidays', label: '节假日', onClick: () => setHolidayCalendar(record) },
    ],
    width: 240,
    desktopInlineKeys: ['holidays', 'edit', 'delete'],
  });

  const columns: ColumnProps<WorkCalendar>[] = [
    { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '时区', dataIndex: 'timezone', width: 140 },
    {
      title: '工作日', dataIndex: 'workdays', width: 220,
      // ★0=周日…6=周六，展示时按同一编码映射
      render: (v: number[]) => <Typography.Text size="small">{v.slice().sort().map((d) => WEEKDAY_LABELS[d] ?? d).join('、')}</Typography.Text>,
    },
    {
      title: '工作时段', dataIndex: 'dailyHours', minWidth: 200,
      render: (v: { start: string; end: string }[]) => (
        <Typography.Text size="small">{v.map((h) => `${h.start}~${h.end}`).join('，')}</Typography.Text>
      ),
    },
    createdAtColumn,
    status.column(),
    operationColumn,
  ];

  const holidayRows = useMemo(() => holidaysQuery.data ?? [], [holidaysQuery.data]);

  async function submitHoliday() {
    if (!holidayCalendar) return;
    const specialHours = holidayForm.specialHoursText.trim()
      ? holidayForm.specialHoursText.split(',').map((s) => s.trim()).filter(Boolean)
        .map((seg) => ({ start: seg.split('-')[0]?.trim() ?? '09:00', end: seg.split('-')[1]?.trim() ?? '18:00' }))
      : null;
    await createHoliday.mutateAsync({
      params: { id: holidayCalendar.id },
      body: { date: holidayForm.date, isWorkday: holidayForm.isWorkday, specialHours },
    });
    setHolidayForm({ date: '', isWorkday: false, specialHoursText: '' });
  }

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword']}
        create={<CreateButton permission="workflow:calendar:create" onClick={() => calendarModal.openCreate()} />}
        filterTitle="日历筛选"
      />

      <ConfigurableTable<WorkCalendar> columns={columns} {...tableProps} />

      <EditFormModal modal={calendarModal} width={660}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Input field="name" label="名称" placeholder="如：标准工作日" rules={[{ required: true, message: '名称不能为空' }]} />
          </Col>
          <Col span={12}>
            <Form.Input field="timezone" label="IANA 时区" placeholder="Asia/Shanghai" rules={[{ required: true, message: '时区不能为空' }]} />
          </Col>
        </Row>
        <Form.Input
          field="hoursText"
          label="工作时段"
          placeholder="09:00-12:00,13:00-18:00（多段用逗号分隔，即跳过午休）"
          rules={[{ required: true, message: '工作时段不能为空' }]}
        />
        <Typography.Text type="tertiary" size="small">
          工作日请在保存后用日历编辑接口维护；界面默认周一至周五。节假日 / 调休请在列表「节假日」中维护（isWorkday=true 表示补班，可指定特殊时段）。
        </Typography.Text>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col span={12}>
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} rules={[{ required: true, message: '请选择状态' }]} />
          </Col>
        </Row>
      </EditFormModal>

      <AppModal
        title={`节假日 / 调休 · ${holidayCalendar?.name ?? ''}`}
        visible={holidayCalendar != null}
        onCancel={() => setHolidayCalendar(null)}
        footer={<Button type="primary" onClick={() => setHolidayCalendar(null)}>关闭</Button>}
        width={720}
        closeOnEsc
      >
        <Table<WorkflowCalendarHoliday>
          size="small"
          dataSource={holidayRows}
          rowKey="id"
          empty="暂无节假日"
          pagination={false}
          columns={[
            { title: '日期', dataIndex: 'date', width: 120 },
            {
              title: '类型', dataIndex: 'isWorkday', width: 100,
              render: (v: boolean) => <Tag size="small" color={v ? 'green' : 'red'}>{v ? '补班' : '放假'}</Tag>,
            },
            {
              title: '特殊时段', dataIndex: 'specialHours', minWidth: 160,
              render: (v: { start: string; end: string }[] | null) => (
                <Typography.Text size="small">{v && v.length > 0 ? v.map((h) => `${h.start}~${h.end}`).join('，') : '—'}</Typography.Text>
              ),
            },
            {
              title: '操作', width: 80,
              render: (_: unknown, r: WorkflowCalendarHoliday) => (
                <Button
                  size="small" type="danger" theme="borderless"
                  disabled={!hasPermission('workflow:calendar:update')}
                  onClick={() => holidayCalendar && deleteHoliday.mutateAsync({ params: { id: holidayCalendar.id, holidayId: r.id } })}
                >
                  删除
                </Button>
              ),
            },
          ]}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
          <div>
            <Typography.Text size="small" type="tertiary">日期</Typography.Text>
            <Input
              value={holidayForm.date}
              placeholder="2027-02-06"
              onChange={(v) => setHolidayForm((p) => ({ ...p, date: v }))}
              style={{ width: 160 }}
            />
          </div>
          <div>
            <Typography.Text size="small" type="tertiary">类型</Typography.Text>
            <Select
              value={holidayForm.isWorkday ? 'work' : 'off'}
              onChange={(v) => setHolidayForm((p) => ({ ...p, isWorkday: v === 'work' }))}
              style={{ width: 120 }}
              optionList={[{ value: 'off', label: '放假' }, { value: 'work', label: '补班' }]}
            />
          </div>
          <div>
            <Typography.Text size="small" type="tertiary">特殊时段（补班可选）</Typography.Text>
            <Input
              value={holidayForm.specialHoursText}
              placeholder="09:00-17:00"
              onChange={(v) => setHolidayForm((p) => ({ ...p, specialHoursText: v }))}
              style={{ width: 180 }}
            />
          </div>
          <Button
            theme="solid" type="primary"
            disabled={!holidayForm.date || createHoliday.isPending}
            onClick={() => void submitHoliday()}
          >
            新增
          </Button>
        </div>
      </AppModal>
    </div>
  );
}
