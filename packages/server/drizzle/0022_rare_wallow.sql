CREATE TYPE "public"."workflow_task_sla_status" AS ENUM('IDLE', 'RUNNING', 'SUSPENDED', 'DONE');--> statement-breakpoint
-- 'slaApprove' 已由 0021_add_sla_approve_node_type.sql 以 ADD VALUE IF NOT EXISTS 追加，此处不再重复（重复会报 enum label already exists）
CREATE TABLE "work_calendar_holidays" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "work_calendar_holidays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"calendar_id" integer NOT NULL,
	"date" date NOT NULL,
	"is_workday" boolean NOT NULL,
	"special_hours" jsonb,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wch_calendar_date_uniq" UNIQUE("calendar_id","date")
);
--> statement-breakpoint
CREATE TABLE "work_calendars" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "work_calendars_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"workdays" integer[] DEFAULT '{1,2,3,4,5}' NOT NULL,
	"daily_hours" jsonb DEFAULT '[{"start":"09:00","end":"12:00"},{"start":"13:00","end":"18:00"}]'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_calendars_name_tenant_uniq" UNIQUE("name","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_task_sla_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_task_sla_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"instance_id" integer NOT NULL,
	"node_id" varchar(64) NOT NULL,
	"sla_node_key" varchar(96) NOT NULL,
	"type" varchar(16) NOT NULL,
	"applicant_id" integer NOT NULL,
	"applicant_name" varchar(64),
	"requested_duration" varchar(32),
	"requested_ms" bigint,
	"reason" text,
	"sla_approver_ids" integer[],
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"approver_id" integer,
	"approver_name" varchar(64),
	"approved_at" timestamp with time zone,
	"result" text,
	"tenant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "sla_status" "workflow_task_sla_status" DEFAULT 'IDLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "sla_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "sla_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "sla_work_elapsed_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "sla_suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_calendar_holidays" ADD CONSTRAINT "work_calendar_holidays_calendar_id_work_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."work_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar_holidays" ADD CONSTRAINT "work_calendar_holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar_holidays" ADD CONSTRAINT "work_calendar_holidays_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar_holidays" ADD CONSTRAINT "work_calendar_holidays_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendars" ADD CONSTRAINT "work_calendars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendars" ADD CONSTRAINT "work_calendars_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendars" ADD CONSTRAINT "work_calendars_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_sla_requests" ADD CONSTRAINT "workflow_task_sla_requests_task_id_workflow_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_sla_requests" ADD CONSTRAINT "workflow_task_sla_requests_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_sla_requests" ADD CONSTRAINT "workflow_task_sla_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wch_calendar_idx" ON "work_calendar_holidays" USING btree ("calendar_id");--> statement-breakpoint
CREATE INDEX "wf_sla_req_task_idx" ON "workflow_task_sla_requests" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "wf_sla_req_instance_idx" ON "workflow_task_sla_requests" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "wf_sla_req_sla_node_idx" ON "workflow_task_sla_requests" USING btree ("sla_node_key");