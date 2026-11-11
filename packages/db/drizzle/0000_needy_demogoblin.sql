CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_executions" ADD CONSTRAINT "node_executions_execution_id_workflow_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE cascade ON UPDATE no action;