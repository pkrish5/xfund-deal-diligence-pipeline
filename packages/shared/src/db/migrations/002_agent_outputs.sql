-- Stores structured outputs from every pipeline phase:
-- research (9 domain agents), verification, scorecard, memo, review
CREATE TABLE IF NOT EXISTS agent_outputs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id uuid REFERENCES workflow_runs(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES deals(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('research', 'verification', 'scorecard', 'memo', 'review')),
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_response text,
  model_used text,
  strategy_used text,
  tokens_used integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_outputs_run ON agent_outputs(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_deal_phase ON agent_outputs(deal_id, phase);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_deal_agent ON agent_outputs(deal_id, agent_key, phase);
