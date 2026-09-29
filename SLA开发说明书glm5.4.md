# SLA 智能计时工作流 · 开发说明书 GLM-5.4（完整施工版·自包含）

> 版本链：HY3（初版）→ HY4（纠错）→ deep（审查论证+污染点）→ glm5.2（实现蓝图）→ glm5.3（最终施工版）→ **glm5.4（完整施工版·自包含）**。
> 本版定位：**单文件可完整开发**。= glm5.3 全部修正 + glm5.2 全部实体内容（类型/schema/迁移/排期）+ 本轮磁盘实读发现的 3 处缺陷修正（D1–D3）+ 3 处留白补全（L1–L3）+ 迁移流程澄清（M1）。
> 纯算法完整实现已单独提取至 **《SLA算法.md》**（配套使用）；除此之外**不再需要翻 deep/glm5.2/5.3**。
> 事实核查与论证见 `SLA开发说明书deep.md`；凝练版见 `功能及规范.md`。
>
> 底座：`F:\wuye\zenith-admin-master`（npm workspace，Hono + React + Drizzle，契约驱动；server=`packages/server`，shared=`packages/shared`，web=`packages/web`）。
>
> **⚠️ 2026-09-28 增补（向上游提 PR 施工以此为准）**：目标底座切换为 `f:/zenith/zenith-admin`（用户 fork 克隆，上游 `iwangbowen/zenith-admin` 已演进至迁移 0020）。本轮二次实读发现 **3 处时钟逻辑缺陷（D4–D6）+ 1 处迁移编号冲突（M3）+ 1 处行号漂移（R1）**，修正已直接落入正文，清单见 §0.1。

---

## 0. glm5.3 → glm5.4 修正与补全表（本版增量）

| # | glm5.3 的做法/留白 | 本轮磁盘实读事实 | glm5.4 修正/补全 |
|---|---|---|---|
| D1 | `loadWorkCalendar` 列为"已固化导入路径" | 仓库**无** `calendars.service.ts` / `loadWorkCalendar`（全仓库 `WorkCalendar` 0 匹配）——照 2.10 直接 import 编译失败 | 2.13 给出约定签名+示例实现；2.10 导入处标注施工顺序：**先日历 Service 后 SLA Service** |
| D2 | `rows` 构造未写 `approveRatio` | `resolveSlaResolution` 读 `siblings[].approveRatio`；节点配置确有该字段（`shared types.ts:287`）、表列已存在（`workflow.ts:505`）——不写则 ratio 会签永远退化为默认 51% | rows 写入 `approveRatio: method==='ratio' ? (cfg?.approveRatio ?? 51) : null` |
| D3 | 伪节点 `type:'approve'` + 仅 `...approver` 展开 | `resolveAssigneeIds` 读的是 `node.assigneeType`（`resolver.service.ts:422`），**不读 `node.type`**；缺 `assigneeType` 直接 `return []`（`:423`）→ 创建申请必抛"审批人解析为空" | 伪节点显式透传 `assigneeType` 及全部审批人字段 |
| L1 | 前端 `slaDecideMutation` 只提名字未给写法 | 项目标准模式：`useApiMutation(contract, { invalidate })`（`web/src/hooks/queries/workflow-tasks.ts:113-115` 协办 hook 即此模式） | 2.12 给出 2 个 hooks 完整代码 |
| L2 | SLA 系列 Zod schema 只引用未定义 | 契约 op 引用 4 个 schema 无定义 | 2.11 给出全部字段定义 |
| L3 | `computeTaskSlaSmart` 无 SUSPENDED 处理；`WorkflowSLATag` 无挂起态 | `WorkflowSLATag.tsx:20` 会把 `overdueSec==null` 拦成"—"，挂起任务显示错误 | 2.8 加 `suspended` 分支；2.12 给 `WorkflowSLATag` 扩展代码 |
| M1 | 0013 迁移只有 ALTER TYPE，5 列+3 表的迁移无说明 | drizzle 先例：pgEnum 追加值手写（`0003`），表/列由 `db:generate` 生成 | 2.5 明确三步：手写 0013 → 改 schema → `db:generate` 生成 0014 |
| M2 | 大量"同 glm5.2 §x.x"引用 | 单文件开发需求 | glm5.2 全部实体内容并入本版正文 |

### 0.1 2026-09-28 二次实读修正（底座 = `f:/zenith/zenith-admin`，fork 上游已演进）

| # | 缺陷/漂移 | 实测事实 | 修正（已落入正文） |
|---|---|---|---|
| D4 | RESUME 分支不重置 `slaStartedAt` | 挂起→恢复→再挂起：`elapsed = W(T0→T1) + W(T0→T2)`（T0=激活时刻，恢复后仍指向 T0），首次挂起前工时被**双计** | §2.10 RESUME 分支补 `slaStartedAt: new Date()`（恢复即重置计时起点） |
| D5 | DELAY 分支写 `slaWorkElapsedMs: 0` | 破坏不变量 `elapsed + W(startedAt→now) = 累计工时`：挂起过（elapsed>0）再延时被清零 → 后续 RESUME 的 remaining 被放大回满额 | §2.10 DELAY 分支删除该 set（延时只顺延截止时刻，不动累计） |
| D6 | DELAY/SUSPEND/RESUME 在 `cal==null` / `addWorkTime==null` 时静默跳过 | 申请已置 APPROVED 但时钟不动：DELAY 截止未变；RESUME 停在 SUSPENDED 且 `cancelJobs` 已撤作业不重排 → **时钟冻死**。违反《SLA算法.md》规则 3「调用方必须降级墙钟，绝不静默吞掉」 | 三分支补墙钟降级（§2.10）：DELAY=原截止+requestedMs；SUSPEND=全时段结算（偏严安全侧）；RESUME=挂起时刻截止差顺延 |
| M3 | 迁移 0013/0014 编号已被占用 | fork 克隆 `drizzle/` 已到 **0020**（上游 4 天新推 8 个迁移），0013/0014 是别的功能 | 手写 **0021** + `db:generate` 生成 **0022**（§2.5 已更新） |
| R1 | `TaskDetailPage.tsx` 动作区行号漂移 | `:414-418` 实为流转记录（ApprovalTimeline）；动作提交实际在 `~:216-261`（`actionMutation.mutateAsync(:261)`） | §2.12④ 已更正 |
| 备注1 | 菜单 `id=4240` | `seed/menus/workflow.ts` 中 4010–4190 十位号全占用，42xx 段空闲（仅 4200 目录）→ **4240 无冲突可用**；贴惯例可改 4210，二选一 | 保持 4240（无冲突） |
| 备注2 | `WorkflowSlaLevel` 上游已存在 | `constants.ts:315` `WORKFLOW_SLA_LEVELS` 四值 + `types.ts:1033` 派生——与 §2.2 注预判一致 | 按 §2.2 注：**数组追加 `'suspended'`**，勿重复 export（重标识符编译错） |
| 备注3 | 组件实际路径（原版未断言，补注防找错） | `WorkflowSLATag.tsx`/`WorkflowApprovalDetailSheet.tsx`/`workflow-task-columns.tsx` 在 `web/src/components/workflow/`；`ApprovalTimeline.tsx` 在 `web/src/components/`；移动端两页在 `web/src/approval/pages/`；设计器面板在 `web/src/pages/workflow/designer/components/tabs/` | 施工按此寻址 |

其余 ~30 处引用点复核**全部命中**：`async-jobs.ts:92`、`task-timeout.ts:38-55/:62`、`queries.ts:67-84/:125/:211/:214/:310`、`resolver:417/:422`、`shared.ts:50-61/:178`、`materialize.ts:599`、`instances/assignees.ts:122`、`introspection:615`、`diagnostics.ts:62-71`、`workflow-engine.ts:525-539`（联锁成立）、契约 `instances.ts:49-75` `tasks.ts:132/:156`、`WorkflowSLATag.tsx:20`、`ApprovalTimeline.tsx:59-82`、`ApproverAdvancedSections.tsx`（「超时未处理」面板：『计时方式』二选一「墙钟模式 / 智能 SLA 模式」分段选择器，共享动作/提醒/升级，智能模式展开 `smartSla` 表单）、`page-registry.ts:26-30`、Sheet `:217-220/:393-397/:399/:402`、`TaskListPage.tsx:215`、`workflow-task-columns.tsx:120/:133`。

### 0.2 待拍板事项（2026-09-29 施工后确认；当前均按「方案 A」实现）

| # | 事项 | 方案 A（当前实现 / 建议） | 方案 B（按原文档执行） |
|---|---|---|---|
| ① | 官方 `WorkflowTimeoutConfig.unit` 是否追加 `'workdays'`（§2.2） | **不追加**，保持 `'minutes' \| 'hours' \| 'days'`。理由：官方墙钟 `computeTaskSla` 对未知单位静默按「小时」折算，追加后在 wallclock 模式会产生错误时限，违反铁律 1「官方墙钟零破坏」；功能无损——智能 SLA 单位由 `smartSla.unit` 承载（已含 `'workdays'`） | 追加 `'workdays'`，但**必须**同步修 `queries.ts` 的 `computeTaskSla`（或收敛 `SlaTimeoutInput` 类型）为其定义明确口径，并补单测；否则静默降级 |
| ② | `package-lock.json` 的 74 行删除（npm install 清理 optional/dev peer，如 `@docsearch/js` 下的 `@types/react`/`react`） | 提 PR 前 `git checkout -- package-lock.json` 还原，让 diff 只含功能改动（下次 install 可能复现该变更） | 保留并一并提交——PR diff 混入无关噪音，易被作者要求拆分 |

> ⚠️ 施工过程记录：本轮曾按方案 B 实现 ①，随后 `tsc` 暴露 `SlaTimeoutInput` 类型不匹配（`WorkflowTimeoutConfig.unit` 超出该类型联合），已回退为方案 A。若改回 B，须一并放宽 `SlaTimeoutInput`。
>
> 备注：`npm run build -w @zenith/web` 报「生产构建必须设置唯一的 `VITE_DEPLOYMENT_ID`」属仓库既有环境变量要求，非本次改动引入（`tsc` 干净）。

---

## 第一部分 · 功能与规范

### 1.1 功能一句话
给审批节点加"智能 SLA"：只在工作日历工作时段计时（跳过周末/节假日/午休）；支持延时/挂起/恢复；SLA 审批人独立多选（会签策略追随节点 `approveMethod`）；官方墙钟超时零破坏。

### 1.2 数据模型
| 表/列 | 范式 |
|---|---|
| `work_calendars`（新） | `idColumn + tenantIdColumn + auditColumns + timestampColumns`（wiki 域风格，独立可维护资源） |
| `work_calendar_holidays`（新） | 同上 + `references(workCalendars.id, onDelete:'cascade')` |
| `workflow_tasks` 追加 5 列 | `slaStatus/slaStartedAt/slaDeadline/slaWorkElapsedMs/slaSuspendedAt`（**不加 tenantId**，沿用官方表） |
| `workflow_task_sla_requests`（新） | `idColumn + tenantIdColumn + createdAt`（**`workflowTaskTransfers` 风格**，无 auditColumns/updatedAt）；用 `slaNodeKey` 批次键（非单一 slaTaskId，一个申请生成 N 条任务行） |
| pgEnum | `workflow_node_type` 追加 `'slaApprove'`；新增 `workflow_task_sla_status`（`IDLE/RUNNING/SUSPENDED/DONE`） |

### 1.3 三条架构决策
- **A｜超时判定 = 作业排期时刻**：`task-timeout.ts` 不读 DB 时间列，只改 `runAt` 即可，官方 remind/escalate/autoApprove/transferToManager 零改动。
- **B｜`sla_*` 列 = 展示缓存**：激活时落库，展示层优先取落库值（双轨制，借鉴 neat `expire_time`/`realexpire_time`）。
- **C｜日历进既有 workflow 域**：`/api/workflows/calendars`，权限 `workflow:calendar:*`，不新建域。

### 1.4 铁律
1. 零破坏：官方墙钟全链路行为不变；只追加不替换。
2. 枚举**四端同步**：pgEnum（`db/schema/workflow.ts:56`）/ TS 联合（`types.ts:55`）/ Zod（`validation.ts:28`）/ `WORKFLOW_NODE_TYPE_LABELS: Record<...>`（`constants.ts:57`，`Record` 强约束，漏则编译报错）。
3. `validateFlowData` 的 `validNodeTypes` Set（`workflow-engine.ts:525-539`）**不加** `slaApprove` → 结构上保证它永不为流程节点（安全联锁）。
4. SLA 任务用独立 `nodeKey`（`${原nodeKey}__sla${type}${reqId}`）+ 每次新 `randomUUID()` 作 `activationId`（`activationId` notNull，`workflow.ts:523`）→ 天然规避 `wf_tasks_active_uniq`（`:536-538`）。
5. SLA 审批走独立 service，**严禁**调 `approveTaskCore`/`rejectTaskCore`。
6. 污染点 P1–P5 + 时间线排除（2.9），缺一即线上异常。

---

## 第二部分 · 实现蓝图（可编译倾向代码）

### 2.1 纯计时算法 `packages/shared/src/workflow/sla-calendar.ts`（新建）

**完整实现（约 90 行，直接复制）与单测清单已单独提取至《SLA算法.md》**；此处保留类型规范与函数契约：

```ts
/** 算法消费的日历结构（★规范定义与完整实现见《SLA算法.md》；由 2.13 loadWorkCalendar 映射） */
export interface WorkCalendarHours { start: string; end: string }
export interface WorkCalendarHoliday { date: string; isWorkday: boolean; specialHours?: WorkCalendarHours[] | null }
export interface WorkCalendarLike {
  timezone: string;                 // IANA 时区，如 'Asia/Shanghai'
  workdays: number[];               // ★0=周日 … 6=周六（JS getUTCDay 编码），不是 1-7
  dailyHours: WorkCalendarHours[];  // 每日工作时段（多段=跳午休）
  holidays?: WorkCalendarHoliday[]; // ★数组（非 Map）；date='yyyy-MM-dd'（日历时区）
}

/** from 起顺延 duration 个 unit（workdays=工作日）→ 截止时刻；日历扫描超 MAX_SCAN_DAYS(3650) 天返回 null（调用方降级墙钟） */
export function computeWorkCalendarDeadline(
  from: Date, duration: number, unit: 'minutes' | 'hours' | 'days' | 'workdays', cal: WorkCalendarLike,
): Date | null;

/** from 起顺延 ms 毫秒**工作时间** → 新截止时刻；超上限返 null */
export function addWorkTime(from: Date, ms: number, cal: WorkCalendarLike): Date | null;

/** [from, to] 区间内的净工作毫秒数（挂起结算用） */
export function computeWorkTimeBetween(from: Date, to: Date, cal: WorkCalendarLike): number;

/** duration+unit → 毫秒（workdays 按 8h/日历日折算）；非法返 null */
export function toDurationMs(
  duration: number, unit: 'minutes' | 'hours' | 'days' | 'workdays', cal: WorkCalendarLike,
): number | null;
```

要点：`MAX_SCAN_DAYS=3650`；时区换算用 `Intl.DateTimeFormat`（`en-US` + `timeZone` + `hour12:false` 取 y/M/d/H/m/s），禁止手工偏移；跨日时段从 `workdays` 起点扫，节假日表覆盖 `workdays`；`holidays` 中 `isWorkday:true` 表示调休上班（可带 `specialHours`）。

### 2.2 类型扩展 `packages/shared/src/workflow/types.ts`

```ts
export interface WorkflowTimeoutConfig {
  // ↓ 官方原字段一字不改（types.ts:218-238） ↓
  enabled: boolean; duration: number;
  unit?: 'minutes' | 'hours' | 'days';   // 官方墙钟不含 'workdays'（见 §0.1 决策①）；智能 SLA 单位由 smartSla.unit 承载
  action: 'remind' | 'autoApprove' | 'autoReject';
  remindCount?: number;
  escalateAction?: 'none' | 'autoApprove' | 'autoReject' | 'transferToManager';
  escalateManagerLevel?: number;
  escalateFallbackAction?: 'none' | 'autoApprove' | 'autoReject';
  // ↓ 新增 ↓
  timeoutMode?: 'wallclock' | 'smart';
  smartSla?: WorkflowSmartSlaConfig;
}
export type WorkflowTimeoutMode = 'wallclock' | 'smart';

/** ★字段与 WorkflowNodeConfig 审批人字段同名（types.ts:259-271 范式）——2.10 伪节点解析的前提 */
export interface WorkflowSlaApprover {
  assigneeType: WorkflowAssigneeType;
  userIds?: number[] | null; roleIds?: number[] | null; deptIds?: number[] | null;
  userGroupIds?: number[] | null; postIds?: number[] | null;
}
export interface WorkflowSmartSlaConfig {
  enabled: boolean; duration: number;
  unit: 'minutes' | 'hours' | 'days' | 'workdays';
  calendarId: number;
  allowDelay: boolean; allowSuspend: boolean; requireSlaApproval: boolean;
  slaApprovers: WorkflowSlaApprover[]; maxDelayCount: number; maxSuspendCount: number;
}

/** SLA 展示级别：官方 4 态 + 挂起（L3 补全） */
export type WorkflowSlaLevel = 'none' | 'safe' | 'warning' | 'overdue' | 'suspended';
```

> 注：`WorkflowSlaLevel` 若以常量数组/Record 标签形式存在于 shared，同步补 `'suspended'`（编译器会提示漏项）。

### 2.3 常量 `packages/shared/src/workflow/constants.ts`

```ts
export const WORKFLOW_TIMEOUT_MODES = ['wallclock', 'smart'] as const;
export const WORKFLOW_TIMEOUT_MODE_LABELS: Record<WorkflowTimeoutMode, string> =
  { wallclock: '官方墙钟', smart: '智能 SLA（工作日历）' };
export const WORKFLOW_TASK_SLA_STATUSES = ['IDLE', 'RUNNING', 'SUSPENDED', 'DONE'] as const;
export type WorkflowTaskSlaStatus = (typeof WORKFLOW_TASK_SLA_STATUSES)[number];
export const WORKFLOW_SLA_REQUEST_TYPES = ['DELAY', 'SUSPEND', 'RESUME'] as const;
export const WORKFLOW_SLA_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
// ⚠️ WORKFLOW_NODE_TYPE_LABELS（:57）必须补 slaApprove: 'SLA 审批'，否则 Record 强约束编译报错（P6）
```

### 2.4 Schema `packages/server/src/db/schema/workflow.ts`

```ts
// :56 pgEnum 末尾追加
export const workflowNodeTypeEnum = pgEnum('workflow_node_type', [
  'start','approve','handler','end','exclusiveGateway','parallelGateway','inclusiveGateway',
  'routeGateway','ccNode','delay','trigger','subProcess','catchNode','slaApprove',
]);
export const workflowTaskSlaStatusEnum = pgEnum('workflow_task_sla_status',
  ['IDLE', 'RUNNING', 'SUSPENDED', 'DONE']);

// workflowTasks（:485-539）在 createdAt(:526) 前追加（不加 tenantId）
slaStatus:        workflowTaskSlaStatusEnum().default('IDLE').notNull(),
slaStartedAt:     timestamp({ withTimezone: true }),
slaDeadline:      timestamp({ withTimezone: true }),
slaWorkElapsedMs: bigint({ mode: 'number' }).default(0).notNull(),
slaSuspendedAt:   timestamp({ withTimezone: true }),

// workCalendars / workCalendarHolidays（新表，wiki 域风格）
export const workCalendars = pgTable('work_calendars', {
  id: idColumn(), name: varchar({ length: 128 }).notNull(),
  timezone: varchar({ length: 64 }).default('Asia/Shanghai').notNull(),
  workdays: integer().array().notNull().default([1,2,3,4,5]),   // ★0=周日…6=周六（getUTCDay，见 SLA算法.md）；周六=6、周日=0
  dailyHours: jsonb().$type<{start:string;end:string}[]>()
    .notNull().default([{start:'09:00',end:'12:00'},{start:'13:00',end:'18:00'}]),
  status: statusColumn(), tenantId: tenantIdColumn(),
  ...auditColumns(), ...timestampColumns(),
}, (t) => [unique('work_calendars_name_tenant_uniq').on(t.name, t.tenantId)]);

export const workCalendarHolidays = pgTable('work_calendar_holidays', {
  id: idColumn(),
  calendarId: integer().notNull().references(() => workCalendars.id, { onDelete: 'cascade' }),
  date: date().notNull(), isWorkday: boolean().notNull(),
  specialHours: jsonb().$type<{start:string;end:string}[]>(),
  tenantId: tenantIdColumn(), ...auditColumns(), ...timestampColumns(),
}, (t) => [unique('wch_calendar_date_uniq').on(t.calendarId, t.date), index('wch_calendar_idx').on(t.calendarId)]);

// workflowTaskSlaRequests（新表，workflowTaskTransfers 风格；★slaNodeKey 批次键替代单一 slaTaskId★）
export const workflowTaskSlaRequests = pgTable('workflow_task_sla_requests', {
  id: idColumn(),
  taskId: integer().notNull().references(() => workflowTasks.id, { onDelete: 'cascade' }),
  instanceId: integer().notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  nodeId: varchar({ length: 64 }).notNull(),          // 原处理人节点 key
  slaNodeKey: varchar({ length: 96 }).notNull(),      // ★批次键：本次申请生成的 slaApprove 任务行共享的 nodeKey
  type: varchar({ length: 16 }).notNull(),            // DELAY | SUSPEND | RESUME
  applicantId: integer().notNull(), applicantName: varchar({ length: 64 }),
  requestedDuration: varchar({ length: 32 }), requestedMs: bigint({ mode: 'number' }),
  reason: text(), slaApproverIds: integer().array(),
  status: varchar({ length: 16 }).default('PENDING').notNull(),
  approverId: integer(), approverName: varchar({ length: 64 }),
  approvedAt: timestamp({ withTimezone: true }), result: text(),
  tenantId: tenantIdColumn(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('wf_sla_req_task_idx').on(t.taskId),
  index('wf_sla_req_instance_idx').on(t.instanceId),
  index('wf_sla_req_sla_node_idx').on(t.slaNodeKey),   // ★决议时按批次键查
]);
```

### 2.5 迁移（M1：三步，明确表结构迁移从哪来）

**步骤 1｜手写 `packages/server/drizzle/0021_add_sla_approve_node_type.sql`**（pgEnum 追加值照抄 `0003` 先例，drizzle generate 不产出；★M3：0013/0014 已被上游占用，fork 底座现到 0020）：
```sql
ALTER TYPE "public"."workflow_node_type" ADD VALUE IF NOT EXISTS 'slaApprove';--> statement-breakpoint
```
`drizzle/meta/_journal.json` 追加 `{ "idx": 21, "version": "7", "tag": "0021_add_sla_approve_node_type", "breakpoints": true }`（idx 以 `_journal.json` 实际末尾顺延 +1 为准）。
先例依据：`0003_add_resolved_in_app_message_type.sql`（同形态）；`src/db/migrate.ts` 项目侧无事务包裹（`ADD VALUE` 也不能在事务内）。

**步骤 2｜完成 2.4 schema 修改后**：`npm run db:generate -w @zenith/server` 生成 `0022_xxx.sql`（自动包含 `workflow_task_sla_status` 枚举、workflowTasks 5 列、三张新表及索引）。

**步骤 3｜`npm run db:migrate -w @zenith/server`**，验证：
```sql
SELECT unnest(enum_range(NULL::workflow_node_type));   -- 含 'slaApprove'
\d workflow_task_sla_requests                          -- 表存在
```

### 2.6 ★排期钩子★ `packages/server/src/services/workflow/instances/async-jobs.ts:95`

```ts
if ((task.nodeType === 'approve' || task.nodeType === 'handler') && task.status === 'pending') {
  const cfgTimeout = cfg.timeout;
  if (!cfgTimeout?.enabled) return;
  const startAt = new Date();
  let deadline: Date | null = null;
  // 智能 SLA：优先按工作日历口径算截止（跳过午休 / 周末 / 节假日）
  if (cfgTimeout.timeoutMode === 'smart' && cfgTimeout.smartSla?.enabled && cfgTimeout.smartSla.calendarId) {
    const cal = await loadWorkCalendar(cfgTimeout.smartSla.calendarId, executor);
    if (cal) {
      deadline = computeWorkCalendarDeadline(startAt, cfgTimeout.smartSla.duration, cfgTimeout.smartSla.unit ?? 'hours', cal);
    }
    // cal==null / 扫描耗尽 → deadline 仍为 null，下方降级官方墙钟（D6：绝不静默吞掉）
  }
  // 墙钟模式 或 智能日历不可用：官方墙钟口径兜底；同样落库 SLA 列，保持时钟状态一致
  if (!deadline) deadline = computeTimeoutAt(cfgTimeout, startAt);
  if (deadline) {
    await executor.update(workflowTasks)
      .set({ slaStatus: 'RUNNING', slaStartedAt: startAt, slaDeadline: deadline })
      .where(eq(workflowTasks.id, task.id));
    await enqueueJob({ ...base, jobType: 'task_timeout', runAt: deadline, maxAttempts: 3, idempotencyKey: `task_timeout:${task.id}` }, executor);
  }
}
```

### 2.7 续期换口径 `packages/server/src/lib/workflow-jobs/handlers/task-timeout.ts:38-55`

在 `scheduleNextTimeout` 内 `computeTimeoutAt(cfg, new Date())` 之前插 smart 分支（用 `computeWorkCalendarDeadline(new Date(), cfg.smartSla.duration, cfg.smartSla.unit, cal)` 算 `next` 作 `runAt`）；`handle()` 主体（`:62-146`）零改动。

### 2.8 展示对接 `packages/server/src/services/workflow/instances/queries.ts`（精确两处 + L3 补全）

```ts
/** ★双轨制：落库 sla_* 优先；IDLE/无值回退官方墙钟 computeTaskSla（:125，零改动）；SUSPENDED 单列挂起态 */
function computeTaskSlaSmart(
  task: { slaStatus: string | null; slaStartedAt: Date | null; slaDeadline: Date | null },
  timeout: SlaTimeoutInput, createdAt: Date,
): { slaLevel: WorkflowSlaLevel; slaDeadline: string | null; slaOverdueSec: number | null } {
  if (task.slaStatus === 'SUSPENDED') {
    return { slaLevel: 'suspended', slaDeadline: null, slaOverdueSec: null };   // L3：挂起不计逾期
  }
  if (task.slaStatus !== 'RUNNING' || !task.slaDeadline) return computeTaskSla(timeout, createdAt);
  const deadlineMs = new Date(task.slaDeadline).getTime();
  const overdueSec = Math.round((Date.now() - deadlineMs) / 1000);
  const totalSec = task.slaStartedAt ? Math.max(1, Math.round((deadlineMs - new Date(task.slaStartedAt).getTime())/1000)) : 3600;
  const slaLevel = overdueSec >= 0 ? 'overdue'
    : (-overdueSec <= Math.max(3600, totalSec * 0.2) ? 'warning' : 'safe');  // 阈值与官方 :134-136 一致
  return { slaLevel, slaDeadline: formatDateTime(new Date(deadlineMs)), slaOverdueSec: overdueSec };
}
// 改 :211（listPendingMine）：const sla = computeTaskSlaSmart(r.task, node?.timeout, r.task.createdAt);
//   （r.task 需含 slaStatus/slaStartedAt/slaDeadline——listPendingMine 已 select 整行 task，天然满足）
// 改 :310（countMyOverduePending）：select 增加 slaStatus/slaStartedAt/slaDeadline，
//   判定改为 computeTaskSlaSmart(row, node?.timeout, row.createdAt).slaLevel === 'overdue'（suspended 不计入逾期角标）
```

### 2.9 ★污染点处置（P1–P5 具体 diff）★

```ts
// P1 queries.ts:67-84 loadActiveNodeKeysByInstance
.where(and(eq(workflowTasks.instanceId, instanceId),
           inArray(workflowTasks.status, ['pending','waiting']),
           ne(workflowTasks.nodeType, 'slaApprove')));   // ← 加这一行
// P2 mapping.ts:83-87 mapInstance：tasks.filter(t => t.nodeType !== 'slaApprove')
// P3 diagnostics.ts:68-71：把 'slaApprove' 加入"有唤醒来源/人工节点"排除集合
// P4 assignees.ts:122：ne(nodeType,'ccNode') → notInArray(workflowTasks.nodeType, ['ccNode','slaApprove'])
// P5 workflow-engine-introspection.service.ts:615：humanTasks 统计加 && row.nodeType !== 'slaApprove'
// P2b ApprovalTimeline.tsx:62 buildNodeProgress：排除集合（已排除 ccNode 处）同位置加 'slaApprove'
```

### 2.10 ★SLA Service★ `packages/server/src/services/workflow/instances/sla-requests.ts`（新建，含 D1–D3 修正）

**导入（路径已核实；⚠️ D1：`loadWorkCalendar` 依赖 2.13 新建的日历 Service，施工顺序=先 2.13 后本文件）**：
```ts
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';          // 构造 (status, { message })
import { db } from '../../db';
import { workflowInstances, workflowTasks, workflowTaskSlaRequests } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { enqueueJob, cancelJobs } from '../../lib/workflow-jobs/engine';   // 二参均支持 (input, executor)
import { resolveRuntimeApproveMethod } from '../../lib/workflow-engine';
import { resolveAssigneeIds } from '../workflow-assignee-resolver.service';
// ⚠️ D1：当前仓库尚无 calendars.service.ts（全仓库 WorkCalendar 0 匹配）——先落地 2.13，本行才能编译
import { loadWorkCalendar } from '../calendars.service';
import { addWorkTime, computeWorkTimeBetween, toDurationMs } from '@zenith/shared/workflow';
import { resolveUserNames } from '../../../lib/user-nicknames';
import { formatDateTime } from '../../../lib/datetime';
import { lockInstanceExpecting, emitTasksEnteredEvents } from './shared';
import type { WorkflowNodeConfig, WorkflowResolvedApproveMethod, WorkflowSlaApprover, WorkCalendarLike } from '@zenith/shared/workflow';
```

**SLA 审批人解析（伪节点法；★D3 修正：显式透传 `assigneeType`，`resolveAssigneeIds` 读 `node.assigneeType`（resolver:422）而非 `node.type`，缺失即 `return []`★）**：
```ts
async function resolveSlaApproverIds(
  approver: WorkflowSlaApprover, ctx: { initiatorId: number; executor: DbExecutor; instanceId: number; formData?: Record<string, unknown> },
): Promise<number[]> {
  const pseudoNode = {
    type: 'approve', key: 'sla', label: 'SLA 审批',
    // ★D3：assigneeType/userIds/roleIds/deptIds/userGroupIds/postIds 必须显式透传，不能仅靠展开
    assigneeType: approver.assigneeType,
    userIds: approver.userIds, roleIds: approver.roleIds, deptIds: approver.deptIds,
    userGroupIds: approver.userGroupIds, postIds: approver.postIds,
  } as unknown as WorkflowNodeConfig;
  return resolveAssigneeIds(pseudoNode, {
    initiatorId: ctx.initiatorId,     // ← ResolveAssigneeContext 必填项（resolver:28）
    executor: ctx.executor, instanceId: ctx.instanceId, formData: ctx.formData,
  });
}
```

**创建申请**：
```ts
export async function createSlaRequest(actor: { userId: number; name?: string | null }, taskId: number,
  input: { type: 'DELAY' | 'SUSPEND' | 'RESUME'; duration?: string; requestedMs?: number; reason?: string }) {
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
      eq(workflowTaskSlaRequests.status, 'APPROVED')));
    if (used >= sla.maxDelayCount) throw new HTTPException(400, { message: `延时次数已达上限 ${sla.maxDelayCount}` });
  }
  if (input.type === 'SUSPEND' && sla.maxSuspendCount > 0) {
    const used = await db.$count(workflowTaskSlaRequests, and(
      eq(workflowTaskSlaRequests.taskId, taskId),
      eq(workflowTaskSlaRequests.type, 'SUSPEND'),
      eq(workflowTaskSlaRequests.status, 'APPROVED')));
    if (used >= sla.maxSuspendCount) throw new HTTPException(400, { message: `挂起次数已达上限 ${sla.maxSuspendCount}` });
  }

  return db.transaction(async (tx) => {
    await lockInstanceExpecting(tx, inst.id, 'running', '实例非运行中');   // 4 参（shared.ts:50-61）

    // 1) 解析审批人（多人多策略并集去重）
    const ids = new Set<number>();
    for (const a of sla.slaApprovers) {
      for (const uid of await resolveSlaApproverIds(a,
        { initiatorId: inst.initiatorId, executor: tx, instanceId: inst.id, formData: inst.formData ?? undefined })) ids.add(uid);
    }
    const approverIds = [...ids];
    if (approverIds.length === 0) throw new HTTPException(400, { message: 'SLA 审批人解析为空' });

    // 2) 写申请明细
    const [req] = await tx.insert(workflowTaskSlaRequests).values({
      taskId, instanceId: inst.id, nodeId: task.nodeKey,
      slaNodeKey: '',                                     // 先占位，拿到 reqId 后回填
      type: input.type, applicantId: actor.userId, applicantName: actor.name ?? null,
      requestedDuration: input.duration ?? null, requestedMs: input.requestedMs ?? null,
      reason: input.reason ?? null, slaApproverIds: approverIds,
      status: 'PENDING', tenantId: inst.tenantId,
    }).returning();
    const slaNodeKey = `${task.nodeKey}__sla${input.type.toLowerCase()}${req.id}`;   // ★批次键（含 reqId 天然唯一）

    // 3) 生成 slaApprove 任务行（会签策略追随节点）
    const method: WorkflowResolvedApproveMethod = resolveRuntimeApproveMethod(cfg?.approveMethod ?? 'or', approverIds.length);
    const activation = randomUUID();                      // ★必填（workflow.ts:523）；天然规避 wf_tasks_active_uniq
    const rows = approverIds.map((uid, i) => ({
      instanceId: inst.id, nodeKey: slaNodeKey, nodeName: `SLA${input.type}`,
      nodeType: 'slaApprove' as const, assigneeId: uid,
      status: method === 'sequential' ? (i === 0 ? 'pending' as const : 'waiting' as const) : 'pending' as const,
      approveMethod: method,
      // ★D2 修正：ratio 会签必须写入 approveRatio（列已存在 workflow.ts:505；节点配置字段 types.ts:287），
      //   否则 resolveSlaResolution 永远退化为默认 51%
      approveRatio: method === 'ratio' ? (cfg?.approveRatio ?? 51) : null,
      activationId: activation,
      taskOrder: method === 'sequential' ? i : null, tenantId: inst.tenantId,
    }));
    const inserted = await tx.insert(workflowTasks).values(rows).returning();

    // 4) 回填批次键
    await tx.update(workflowTaskSlaRequests).set({ slaNodeKey }).where(eq(workflowTaskSlaRequests.id, req.id));

    // 5) 发射事件（待办角标/WS 刷新；TaskRow = 完整 select 行，inserted 正好匹配）
    await emitTasksEnteredEvents(inst.id, inserted,
      { definitionId: inst.definitionId, tenantId: inst.tenantId ?? null, actor }, tx);
    return req;
  });
  // ⚠️ 原处理人任务保持 pending
}
```

**审批决议（按 taskId 寻址 + 会签判定，与官方 `checkNodeCompletion`（materialize.ts:599-690）同构）**：
```ts
type SlaResolution = { decided: false } | { decided: true; approve: boolean };

/** 会签决议：siblings = 同 (instanceId, slaNodeKey, activationId) 的任务行 */
function resolveSlaResolution(siblings: Array<{ status: string; approveMethod: string | null; approveRatio: number | null }>): SlaResolution {
  if (siblings.some((t) => t.status === 'rejected')) return { decided: true, approve: false };
  const method = siblings.find((t) => t.approveMethod)?.approveMethod ?? 'or';
  const approved = siblings.filter((t) => t.status === 'approved').length;
  if (method === 'or')   return approved >= 1 ? { decided: true, approve: true } : { decided: false };
  if (method === 'and')  return siblings.every((t) => t.status === 'approved') ? { decided: true, approve: true } : { decided: false };
  if (method === 'ratio') {
    const ratio = siblings.find((t) => t.approveRatio != null)?.approveRatio ?? 51;   // ← 依赖 D2 写入的列值
    return approved * 100 >= siblings.length * ratio ? { decided: true, approve: true } : { decided: false };
  }
  // sequential：全 approved 才过（逐人唤醒由下方升 pending 逻辑配合）
  return siblings.every((t) => t.status === 'approved') ? { decided: true, approve: true } : { decided: false };
}

/** ★按 taskId 寻址（前端零新增字段，复用审批 Sheet 已有的 taskId）★ */
export async function decideSlaTask(actor: { userId: number; name?: string | null }, taskId: number, approve: boolean, comment: string) {
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
      .where(and(eq(workflowTasks.instanceId, task.instanceId), eq(workflowTasks.nodeKey, task.nodeKey),
                eq(workflowTasks.activationId, task.activationId)));
    const resolution = resolveSlaResolution(siblings);

    // sequential：唤醒下一个 waiting（照抄官方 :654-671 模式）
    if (!resolution.decided && siblings.some((s) => s.status === 'waiting')) {
      const next = siblings.filter((s) => s.status === 'waiting')
        .sort((a, b) => (a.taskOrder ?? 0) - (b.taskOrder ?? 0))[0];
      if (next) await tx.update(workflowTasks).set({ status: 'pending' }).where(eq(workflowTasks.id, next.id));
      return { decided: false };
    }
    if (!resolution.decided) return { decided: false };

    // 3) 决议达成 → 联动跳过兄弟行（照抄官方 or 联动 :644-649）+ 置申请状态
    await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), comment: '[SLA 决议] 其它审批人无需处理' })
      .where(and(eq(workflowTasks.instanceId, task.instanceId), eq(workflowTasks.nodeKey, task.nodeKey),
                inArray(workflowTasks.status, ['pending', 'waiting'])));
    await tx.update(workflowTaskSlaRequests).set({
      status: resolution.approve ? 'APPROVED' : 'REJECTED',
      approverId: actor.userId, approverName: actor.name ?? null,
      approvedAt: new Date(), result: comment,
    }).where(eq(workflowTaskSlaRequests.id, req.id));
    if (!resolution.approve) return { decided: true, approve: false };   // 决议驳回 → 不改时钟

    // 4) 决议通过 → 按 type 改时钟（只动原处理人任务 req.taskId）
    const [orig] = await tx.select().from(workflowTasks).where(eq(workflowTasks.id, req.taskId)).limit(1);
    const cfg = (await tx.select().from(workflowInstances).where(eq(workflowInstances.id, req.instanceId)).limit(1))[0]
      ?.definitionSnapshot?.flowData?.nodes?.find((n) => n.data.key === orig?.nodeKey)?.data;
    const sla = cfg?.timeout?.smartSla;
    if (!orig || !sla) return { decided: true, approve: true };
    const cal = await loadWorkCalendar(sla.calendarId, tx);

    if (req.type === 'DELAY' && orig.slaDeadline && req.requestedMs) {
      const reqMs = Number(req.requestedMs);
      // ★D5：不再写 slaWorkElapsedMs:0——延时只顺延截止时刻，累计工时不变量（elapsed + W(startedAt→now)）保持
      // ★D6：日历不可用/扫描耗尽(null) → 降级墙钟顺延（算法文档规则3：绝不静默吞掉）
      const newDeadline = (cal ? addWorkTime(new Date(orig.slaDeadline), reqMs, cal) : null)
        ?? new Date(new Date(orig.slaDeadline).getTime() + reqMs);
      await tx.update(workflowTasks).set({ slaDeadline: newDeadline })
        .where(eq(workflowTasks.id, orig.id));
      await cancelJobs({ taskId: orig.id, jobType: 'task_timeout' }, tx);                        // 引擎原生支持按 taskId
      await enqueueJob({ jobType: 'task_timeout', taskId: orig.id, instanceId: orig.instanceId,
        payload: { taskId: orig.id }, runAt: newDeadline, maxAttempts: 3,
        idempotencyKey: `task_timeout:${orig.id}`, tenantId: orig.tenantId }, tx);
    } else if (req.type === 'SUSPEND') {
      // ★D6：日历不可用 → 降级全时段墙钟结算（多计非工时=SLA 更严，偏安全侧），绝不静默跳过
      const settleMs = cal
        ? (orig.slaStartedAt ? computeWorkTimeBetween(new Date(orig.slaStartedAt), new Date(), cal) : 0)
        : (orig.slaStartedAt ? Math.max(0, Date.now() - new Date(orig.slaStartedAt).getTime()) : 0);
      const elapsed = Number(orig.slaWorkElapsedMs ?? 0) + settleMs;
      await tx.update(workflowTasks).set({ slaStatus: 'SUSPENDED', slaSuspendedAt: new Date(), slaWorkElapsedMs: elapsed })
        .where(eq(workflowTasks.id, orig.id));
      await cancelJobs({ taskId: orig.id, jobType: 'task_timeout' }, tx);                          // 冻结期取消超时作业
    } else if (req.type === 'RESUME') {
      // ★D4：重置 slaStartedAt=now——恢复即新计时起点；否则再挂起时 W(startedAt→now) 会把挂起前工时再计一遍（双计）
      // ★D6：日历不可用/扫描耗尽 → 降级墙钟：剩余墙钟 = 挂起时刻的截止差（slaDeadline − slaSuspendedAt），从 now 顺延
      const elapsed = Number(orig.slaWorkElapsedMs ?? 0);
      const remainingMs = cal ? Math.max(0, (toDurationMs(sla.duration, sla.unit, cal) ?? 0) - elapsed) : null;
      const wallRemainingMs = (orig.slaDeadline && orig.slaSuspendedAt)
        ? Math.max(0, new Date(orig.slaDeadline).getTime() - new Date(orig.slaSuspendedAt).getTime())
        : null;
      const newDeadline = (cal && remainingMs != null ? addWorkTime(new Date(), remainingMs, cal) : null)
        ?? (wallRemainingMs != null ? new Date(Date.now() + wallRemainingMs) : null);
      if (newDeadline) {
        await tx.update(workflowTasks).set({
          slaStatus: 'RUNNING', slaStartedAt: new Date(), slaDeadline: newDeadline, slaSuspendedAt: null,
        }).where(eq(workflowTasks.id, orig.id));
        await cancelJobs({ taskId: orig.id, jobType: 'task_timeout' }, tx);
        await enqueueJob({ jobType: 'task_timeout', taskId: orig.id, instanceId: orig.instanceId,
          payload: { taskId: orig.id }, runAt: newDeadline, maxAttempts: 3,
          idempotencyKey: `task_timeout:${orig.id}`, tenantId: orig.tenantId }, tx);
      }
    }
    return { decided: true, approve: true };
    // ⚠️ 原处理人任务 status 全程 pending（时钟列除外）
  });
}
```

**时间线装载（照抄 `transfers.ts:96-122`，挂在原任务行上）**：
```ts
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
      id: r.id, type: r.type,
      applicantName: names.get(r.applicantId) ?? `用户#${r.applicantId}`,
      status: r.status, requestedDuration: r.requestedDuration, reason: r.reason, result: r.result,
      approverName: r.approverId != null ? names.get(r.approverId) ?? `用户#${r.approverId}` : null,
      createdAt: formatDateTime(r.createdAt),
    });
    map.set(r.taskId, list);
  }
  return map;
}
// mapping.ts mapTask 增加 slaRequests 参数；queries.ts 实例详情调用处传入 slaReqByTask.get(t.id) ?? null
```

### 2.11 契约（含 L2：Zod schema 全量定义）

**SLA 系列 schema（`shared/src/workflow/contracts/`，随 transfers 模式放 instances.ts；op 用的 body/response 放 tasks.ts）**：
```ts
export const workflowSlaRequestSchema = z.object({
  id: z.number().int(),
  taskId: z.number().int(),
  type: z.enum(['DELAY', 'SUSPEND', 'RESUME']),
  applicantName: z.string().nullable().optional(),
  requestedDuration: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  approverName: z.string().nullable().optional(),
  result: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const createWorkflowSlaRequestSchema = z.object({
  type: z.enum(['DELAY', 'SUSPEND', 'RESUME']),
  duration: z.string().max(32).optional(),          // 人类可读，如 "2h"/"1d"（时间线展示用）
  requestedMs: z.number().int().positive().optional(), // DELAY 必填（时钟顺延依据）
  reason: z.string().max(500).optional(),
}).refine((v) => v.type !== 'DELAY' || v.requestedMs != null, { message: '延时申请必须提供 requestedMs' });

export const decideWorkflowSlaTaskSchema = z.object({
  approve: z.boolean(),
  comment: z.string().max(500).default(''),
});

export const workflowSlaDecideResultSchema = z.object({
  decided: z.boolean(),           // 会签未达决议 = false（本票已计，等其余审批人）
  approve: z.boolean().optional(),
});
```

**任务行挂载**：`workflowTaskSchema`（`contracts/instances.ts:49-75`）在 `actionButtons`(:73) 与 `createdAt`(:74) 之间追加：
```ts
slaRequests: z.array(workflowSlaRequestSchema).nullable().optional(),   // 同 transfers(:66) 模式，挂在原任务行
```

**op 定义**：`workflowTaskContract`（`contracts/tasks.ts:156`，追加在既有 op 之后，`workflowTaskIdParam` 复用 `:132`）：
```ts
slaRequests: op.get('/tasks/{taskId}/sla-requests', {
  access: { permission: 'workflow:task:handle' }, params: workflowTaskIdParam,
  response: z.array(workflowSlaRequestSchema), summary: '任务的 SLA 申请列表' }),
createSlaRequest: op.post('/tasks/{taskId}/sla-requests', {
  access: { permission: 'workflow:task:handle' }, audit: '发起 SLA 申请',
  params: workflowTaskIdParam, body: createWorkflowSlaRequestSchema,
  response: workflowSlaRequestSchema, summary: '发起延时/挂起/恢复申请' }),
decideSlaTask: op.post('/tasks/{taskId}/sla-decide', {          // ★按 taskId 寻址，前端零新增字段
  access: { permission: 'workflow:task:handle' }, audit: 'SLA 审批',
  params: workflowTaskIdParam, body: decideWorkflowSlaTaskSchema,
  response: workflowSlaDecideResultSchema, summary: 'SLA 审批（同意/驳回，不推进原节点）' }),
```

### 2.12 前端（L1：hooks 完整代码 + 三处分流 + 时间线 + L3：挂起态展示）

**① SLA hooks（`packages/web/src/hooks/queries/workflow-tasks.ts` 追加；模式=协办 hook `:113-115` 的 `useApiMutation`）**：
```ts
/** SLA 视图失效：实例全清单（复用既有 invalidateAfterTaskAction）+ SLA 申请列表 */
const invalidateSlaViews = (qc: QueryClient) => {
  invalidateAfterTaskAction(qc);                                                        // 实例详情/待办/已办/监控
  void qc.invalidateQueries({ queryKey: contractKey(workflowTaskContract.slaRequests) }); // 申请列表（前缀失效全 taskId）
};

/** 发起 SLA 申请（延时/挂起/恢复） */
export function useCreateWorkflowSlaRequest() {
  return useApiMutation(workflowTaskContract.createSlaRequest, { invalidate: invalidateSlaViews });
}

/** SLA 审批（同意/驳回，不推进原节点） */
export function useDecideWorkflowSlaTask() {
  return useApiMutation(workflowTaskContract.decideSlaTask, { invalidate: invalidateSlaViews });
}
```

**② Sheet 分流**（`WorkflowApprovalDetailSheet.tsx`；`currentTask` 自 `detail.tasks.find`（`:217-220`），`handleApprove:402`/`handleReject:448` 之前；`taskActionMutation` 定义在 `:399`）：
```tsx
const slaDecideMutation = useDecideWorkflowSlaTask();   // 与 useWorkflowTaskAction(:399) 并列
// handleApprove / handleReject 开头：
if (currentTask?.nodeType === 'slaApprove') {
  await slaDecideMutation.mutateAsync({ params: { taskId }, body: { approve: true, comment: values?.comment ?? '' } });
  Toast.success('SLA 申请已通过'); closeAfterAction(); return;   // 绝不走 taskActionMutation
}
```
失效：`closeAfterAction`（`:393-397`）已统一调 `invalidateAfterTaskAction(queryClient, instanceId)`——hooks 的 `invalidate` 已覆盖，无需页面再拼。

**③ 移动端极速同意分流**（`web/src/approval/pages/TaskListPage.tsx:215`，`quickAction.mutateAsync`）：
```ts
if (item.nodeType === 'slaApprove' && item.pendingTaskId) {   // pendingTaskNodeType 后端已返回（queries.ts:214）
  await slaDecideMutation.mutateAsync({ params: { taskId: item.pendingTaskId }, body: { approve: true, comment: '' } });
  return;                                                     // 绝不走 quickAction
}
```

**④ 移动端详情动作区分流**（`web/src/approval/pages/TaskDetailPage.tsx`，动作提交函数 `~:216-261`——在 `actionMutation.mutateAsync(:261)` 前插分流；★R1：`:414-418` 是流转记录区，勿找错）同 Sheet 模式：nodeType==='slaApprove' 时走 `useDecideWorkflowSlaTask`）。

**⑤ 时间线**（`ApprovalTimeline.tsx`）：
- `buildNodeProgress`（`:59-82`）已按 nodeKey 分组并排除 `ccNode`（`:62`）→ **同位置追加排除 `slaApprove`**（即 P2b）。
- 在 transfers 渲染处（`:278-287`）同模式渲染 `task.slaRequests`：
```tsx
{(task.slaRequests ?? []).map((sr) => (
  <Space key={sr.id} spacing={4} wrap>
    <Clock size={12} />
    <span>
      {sr.type === 'DELAY' ? `申请延时 ${sr.requestedDuration ?? ''}` : sr.type === 'SUSPEND' ? '申请挂起' : '申请恢复'}
      （{sr.applicantName}）→ {sr.status === 'PENDING' ? '待审批' : sr.status === 'APPROVED' ? `${sr.approverName ?? ''} 已通过` : `${sr.approverName ?? ''} 已驳回`}
      {sr.reason ? `（${sr.reason}）` : ''}
    </span>
  </Space>
))}
```

**⑥ L3：`WorkflowSLATag.tsx` 挂起态**（在 `:20` 的 `if (!level || level === 'none' || overdueSec == null)` **之前**插入，否则挂起会被拦成"—"）：
```tsx
if (level === 'suspended') {
  return <Tooltip content="SLA 已挂起，计时暂停"><Tag size="small" color="grey">已挂起</Tag></Tooltip>;
}
```

**⑦ Web 标签**：`workflow-task-columns.tsx:120,133` 的 `WORKFLOW_NODE_TYPE_LABEL` 补 `slaApprove: 'SLA 审批'`（P7）。

### 2.13 日历模块脚手架（D1：`loadWorkCalendar` 在这里，先于 2.10 施工）

**日历 Service `packages/server/src/services/workflow/calendars.service.ts`（新建）——2.6/2.10 的依赖，必须最先落地**：
```ts
/** calendarId=null → 默认日历（兜底）；把 workCalendars/workCalendarHolidays 行映射为算法消费的 WorkCalendarLike */
export async function loadWorkCalendar(
  calendarId: number | null,
  executor: DbExecutor = db,
): Promise<WorkCalendarLike | null> {
  if (calendarId == null) return getDefaultWorkCalendar(executor);
  const [cal] = await executor.select().from(workCalendars)
    .where(and(eq(workCalendars.id, calendarId), eq(workCalendars.status, 'enabled'))).limit(1);
  if (!cal) return null;
  const holidays = await executor.select().from(workCalendarHolidays)
    .where(eq(workCalendarHolidays.calendarId, cal.id));
  return {
    timezone: cal.timezone, workdays: cal.workdays, dailyHours: cal.dailyHours,
    // ★holidays 为数组结构（SLA算法.md 规范），非 Map
    holidays: holidays.map((h) => ({ date: h.date, isWorkday: h.isWorkday, specialHours: h.specialHours ?? null })),
  };
}
```

**其余脚手架（CRUD 全家桶）**：
- 契约 `workCalendarContract`（`/api/workflows/calendars`，`access: platformOnly:'multi-tenant'`）；`list` query 用 `paginationQuery.extend({ keyword: keywordQuery('名称') })`。
- Service `defineCrudService(workCalendarContract, { table: workCalendars, list: (q)=>({ where:[keywordCondition(q.keyword,[workCalendars.name])] }) })`。
- 路由 `mountCrud` + `routes/workflow/index.ts` 追加挂载（不新建域）。
- 菜单 `seed/menus/workflow.ts` 4300 下 `id=4240`；权限 `workflow:calendar:list/create/edit/delete` 加到 `WORKFLOW_PERMISSIONS`，button 自动生成。
- Seed `shared/src/seed/work-calendars.ts` 导出 `SEED_WORK_CALENDARS` → `seed/index.ts` re-export → `db/seed.ts` 用 `overridingSystemValue().values().onConflictDoNothing()` + `setval`。
- Mock：`mocks/data/workflow.ts` 加 store；`mocks/handlers/workflow.ts` 加 3 个 SLA op 的 `mock()`。
- 前端页 `pages/workflow/calendars/WorkCalendarPage.tsx`（**必须 `Page.tsx` 结尾**，`page-registry.ts:26-30` glob）+ `createResourceQueries(workCalendarContract)` hooks。
- 设计器面板 `designer/components/tabs/ApproverAdvancedSections.tsx`（超时面板 `:219-334`）加 `timeoutMode` 切换 + `smartSla` 表单，`slaApprovers` 复用 `AssigneeTypePicker`（`ApproverSettingsTab.tsx:50`）。

**施工顺序总览**：2.1→2.2→2.3→2.4→2.5（步骤1）→2.13（日历 Service，D1）→2.6→2.7→2.10（SLA Service）→2.11→2.12→2.9（污染点）→2.5（步骤2/3 db:generate+migrate）→脚手架收尾→第三部分清单。

---

## 第三部分 · 实现者核对清单

### 3.1 枚举四端同步 + 安全联锁
- [ ] pgEnum（`db/schema/workflow.ts:56`）/ TS（`types.ts:55`）/ Zod（`validation.ts:28`）/ `WORKFLOW_NODE_TYPE_LABELS`（`constants.ts:57`）四处加 `slaApprove`
- [ ] `workflow-engine.ts:525-539` `validNodeTypes` **不加**（联锁）

### 3.2 迁移（M1 三步）
- [ ] 手写 `drizzle/0021_add_sla_approve_node_type.sql`（照抄 `0003`；★M3：fork 底座已到 0020，0013/0014 被占）+ `_journal.json` idx 21
- [ ] 改 schema 后 `npm run db:generate` 生成 0022（含 5 列/3 表/新枚举）
- [ ] `npm run db:migrate`；验证 `enum_range` 含 `slaApprove`、`\d workflow_task_sla_requests`

### 3.3 排期与展示
- [ ] `async-jobs.ts:92` smart 分支（落库 + 日历 runAt）
- [ ] `task-timeout.ts:38-55` 续期 smart 分支
- [ ] `queries.ts:211` / `:310` 改 `computeTaskSlaSmart`（含 **suspended 不计逾期**）

### 3.4 污染点
- [ ] P1 `queries.ts:67-84` / P2 `mapping.ts:83-87` / P3 `diagnostics.ts:68-71` / P4 `assignees.ts:122` / P5 `introspection:615` / P2b `ApprovalTimeline.tsx:62`

### 3.5 SLA Service（含 D1–D3）
- [ ] **D1**：`calendars.service.ts` 已先落地，`loadWorkCalendar` 可用（否则 sla-requests.ts 编译失败）
- [ ] **D2**：rows 写入 `approveRatio`（ratio 会签），单测断言 ratio 阈值生效（非默认 51%）
- [ ] **D3**：伪节点显式透传 `assigneeType`，单测断言审批人解析非空
- [ ] `createSlaRequest`：事务 + `lockInstanceExpecting`（4 参）+ 独立 `slaNodeKey`（含 reqId）+ 新 `randomUUID()` activationId + `emitTasksEnteredEvents`（传 `.returning()` 行）
- [ ] `decideSlaTask`：按 taskId 寻址 + 乐观并发置行 + `resolveSlaResolution` 会签判定（or/and/sequential/ratio）+ 决议后联动 skip 兄弟行 + 时钟操作（DELAY 顺延 / SUSPEND 冻结+`cancelJobs({taskId})` / RESUME 续算+重排）
- [ ] **D4**：RESUME 重置 `slaStartedAt`（单测：挂起→恢复→再挂起，elapsed 不含首次挂起前工时）
- [ ] **D5**：DELAY 不写 `slaWorkElapsedMs:0`（单测：挂起→延时→恢复，remaining 不回满额）
- [ ] **D6**：`cal==null`/`addWorkTime==null` 时三分支墙钟降级 + 作业重排（单测：日历禁用后决议仍动时钟）
- [ ] 原处理人任务全程 pending（单测断言）

### 3.6 前端（含 L1/L3）
- [ ] **L1**：`useCreateWorkflowSlaRequest` / `useDecideWorkflowSlaTask` 落入 `workflow-tasks.ts`（`useApiMutation` 模式）
- [ ] Sheet 分流（`currentTask.nodeType==='slaApprove'` 走 sla-decide）
- [ ] TaskListPage 极速同意（`:215`）、TaskDetailPage 动作区
- [ ] **L3**：`WorkflowSLATag` suspended 分支 + shared `WorkflowSlaLevel` 加 `'suspended'`
- [ ] 时间线内联 SLA 申请（挂在原任务行）+ Web 标签 `slaApprove: 'SLA 审批'`

### 3.7 回归与验收
- [ ] 官方墙钟行为不变；`wallclock` 下 `WorkflowSLATag` 仍 none/safe/warning/overdue
- [ ] slaApprove 行不产生幽灵当前节点、死锁误报、humanTasks 虚高
- [ ] 会签四策略决议正确（单测：or 一人过、and 全过、sequential 顺序、ratio 阈值）
- [ ] SLA 审批任务进待办 → 审批后进已办 → 原节点仍 pending → 时间线内联
- [ ] 挂起后角标不计逾期、展示"已挂起"；恢复后按剩余工作时长重算
- [ ] `npm run build && lint && typecheck:contracts && test -w @zenith/shared && test -w @zenith/web`

---

## 附录一 · 版本分工

| 版本 | 用途 |
|---|---|
| HY3/HY4 | 历史（已被纠错） |
| deep | 审查论证 + 事实核查 + 污染点清单 + 算法参考实现 |
| 功能及规范 | 一眼看懂 |
| glm5.2 | 实现蓝图（实体内容已并入本版） |
| glm5.3 | 最终施工版（修正已并入本版；其自身含 D1–D3 缺陷，勿直接照抄） |
| GLM5.3优化 | D1–D3 论证记录（已并入本版，留作核查） |
| **glm5.4（本版）** | **完整施工版·自包含：单文件可直接开发** |

**一句话结论**：以"只改排期时刻 + 展示缓存 + 独立 slaApprove 任务行（独立 nodeKey/批次键 + approveRatio 落列）+ 污染点全处置 + 会签决议与官方同构 + 伪节点显式透传 assigneeType + 日历 Service 先行"七个切面实现零破坏；最高优先级 4 项——① **先建 `calendars.service.ts`**（D1，否则 SLA Service 编译失败）；② `decide` 按 taskId 寻址 + 会签决议含 ratio 列值（D2）；③ 伪节点显式透传（D3）；④ P1–P5+P2b 排除与移动端两处分流。

---

## 附录二 · 本轮磁盘实读核实（2026-09-24，glm5.4 修正依据）

> 对 `F:\wuye\zenith-admin-master`（packages 结构）逐文件实读，两轮独立验证。

### A. 已确证正确（可直接照做）
| 项 | 实读结论 |
|---|---|
| `emitTasksEnteredEvents(instanceId, tasks: readonly TaskRow[], meta, executor?)` | `shared.ts:178` 一致，2.10 调用 `(_, inserted, {definitionId,tenantId,actor}, tx)` 匹配 |
| `resolveAssigneeIds(node: WorkflowNodeConfig, ctx: ResolveAssigneeContext)` | `resolver.service.ts:417`；`ResolveAssigneeContext`（`:26`）含 `initiatorId:number`(必填)、`executor?`、`formData?`、`instanceId?`；内部读 `node.assigneeType`（`:422`） |
| `enqueueJob(input, executor?)` / `cancelJobs({taskId,...}, executor?)` | `engine.ts:42/86` 原生支持 taskId 与事务执行器 |
| `activationId varchar(36).notNull()`（`workflow.ts:523`）、`approveRatio integer()`（`:505`）、节点配置 `approveRatio?: number`（shared `types.ts:287`） | 全部存在 |
| SLA 5 列 / 3 张新表 / `smartSla` / `WorkflowTimeoutConfig` 扩展 / `calendars.service.ts` | 当前均不存在 → 全部属本版待建 |
| 迁移目录 | 仅 `0000–0012`，0013 编号合理 |
| `computeTaskSla`（`queries.ts:125`） | wallclock 计算，unit 仅 minutes/hours/days（`:129`）→ smart 必须新分支（2.8） |
| `pendingTaskNodeType` | 后端已返回（`queries.ts:214`）→ 移动端分流通路成立 |
| 前端 hook 模式 | `useApiMutation(contract, { invalidate })`（`workflow-tasks.ts:113-115` 协办即此模式）；`useWorkflowTaskAction` 在 `:399` |
| `WorkflowSLATag.tsx` | props `level/overdueSec/deadline`；`:20` 拦截 `overdueSec==null` → suspended 分支须插其前（L3） |
| 契约 op 模式 | `workflowTaskIdParam`（`tasks.ts:132`）、op 形态（`:163-176`）与 2.11 写法一致 |

### B. ⚠️ 与历史 memory 不一致（施工以当前磁盘为准）
- 历史 memory 记「迁移 0014 已落库、workflow.ts 含 timeoutDuration/timeoutUnit 列」——**当前副本迁移仅到 0012，workflow.ts 不含 timeoutDuration/timeoutUnit**。该记录描述的是另一环境（`f:/zenith/zenith-admin`）或旧状态，**不要**据此施工；一切以 `F:\wuye\zenith-admin-master` 当前磁盘为准。

### C. 2026-09-28 fork 底座二次实读（`f:/zenith/zenith-admin`，★向上游提 PR 施工以此为准）
- 迁移目录 **0000–0020**（0013/0014 已被上游占用）→ SLA 迁移改用 **0021/0022**（M3）。
- workflow 域代码与 `F:\wuye` 底座同源：附录二 A 全部引用点复核命中，仅 `TaskDetailPage.tsx` 动作区行号漂移（§0.1 R1）。
- `WorkflowSlaLevel` 已存在于 shared（`constants.ts:315` / `types.ts:1033`）→ 按 §2.2 注**追加 `'suspended'`**，勿重复 export。
- 上游已含 `computeTaskSla`（wallclock）、`WorkflowSLATag`、`WORKFLOW_SLA_LEVELS` 官方超时体系，与 §2.8 双轨制设计吻合，无需新建。
- 组件实际路径见 §0.1 备注3；菜单 `id=4240` 在 fork 底座无冲突可用。
