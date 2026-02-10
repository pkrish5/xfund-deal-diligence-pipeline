CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Single-tenant MVP: keep tenant_id nullable but present for future multi-tenant.
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('gcal','asana','notion','llm')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind)
);

-- GCal watch channel tracking
CREATE TABLE IF NOT EXISTS gcal_watches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id),
  calendar_id text NOT NULL,
  channel_id text NOT NULL,
  resource_id text NOT NULL,
  expiration_ms bigint,
  channel_token text,
  sync_token text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped','replaced','error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, calendar_id, channel_id)
);

-- Main deal mapping: GCal event <-> Asana task <-> Notion workspace
CREATE TABLE IF NOT EXISTS deals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id),
  gcal_calendar_id text NOT NULL,
  gcal_event_id text NOT NULL,
  gcal_ical_uid text,
  company_name text,
  founder_name text,
  asana_task_gid text,
  notion_deal_page_id text,
  notion_urls jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_stage text NOT NULL DEFAULT 'FIRST_MEETING',
  source text NOT NULL DEFAULT 'gcal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, gcal_calendar_id, gcal_event_id)
);

-- Stage tracking for Asana tasks (prevents retriggers on unrelated edits)
CREATE TABLE IF NOT EXISTS asana_task_state (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id),
  task_gid text NOT NULL,
  project_gid text NOT NULL,
  last_seen_section_gid text,
  last_processed_modified_at timestamptz,
  last_triggered_stage text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, task_gid, project_gid)
);

-- Pipeline section mapping (section_gid -> stage key)
CREATE TABLE IF NOT EXISTS pipeline_sections (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id),
  project_gid text NOT NULL,
  section_gid text NOT NULL,
  stage_key text NOT NULL CHECK (stage_key IN ('FIRST_MEETING','IN_DILIGENCE','IC_REVIEW','PASS','ARCHIVE')),
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, project_gid, section_gid)
);

-- Idempotency keys for webhooks + jobs
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Workflow runs (for cancellation & tracking)
CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id),
  deal_id uuid REFERENCES deals(id),
  task_gid text,
  stage_key text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','canceled')),
  cancel_requested boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Schema migrations tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_deals_asana_task ON deals(asana_task_gid);
CREATE INDEX IF NOT EXISTS idx_deals_icaluid ON deals(gcal_ical_uid);
CREATE INDEX IF NOT EXISTS idx_gcal_watches_calendar ON gcal_watches(calendar_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_deal ON workflow_runs(deal_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status) WHERE status = 'running';

-- Seed default tenant for single-tenant MVP
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'default')
ON CONFLICT (id) DO NOTHING;
