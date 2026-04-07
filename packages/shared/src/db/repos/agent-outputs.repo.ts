import { query, queryOne, execute } from '../client.js';
import type { DiligencePhase } from '../../agents/types.js';

export interface AgentOutput {
    id: string;
    run_id: string;
    deal_id: string;
    agent_key: string;
    phase: DiligencePhase;
    output: Record<string, any>;
    raw_response: string | null;
    model_used: string | null;
    strategy_used: string | null;
    tokens_used: number;
    created_at: Date;
}

export async function saveOutput(input: {
    runId: string;
    dealId: string;
    agentKey: string;
    phase: DiligencePhase;
    output: Record<string, any>;
    rawResponse?: string;
    modelUsed?: string;
    strategyUsed?: string;
    tokensUsed?: number;
}): Promise<AgentOutput> {
    const row = await queryOne<AgentOutput>(
        `INSERT INTO agent_outputs (run_id, deal_id, agent_key, phase, output, raw_response, model_used, strategy_used, tokens_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
            input.runId,
            input.dealId,
            input.agentKey,
            input.phase,
            JSON.stringify(input.output),
            input.rawResponse ?? null,
            input.modelUsed ?? null,
            input.strategyUsed ?? null,
            input.tokensUsed ?? 0,
        ]
    );
    return row!;
}

export async function getOutputsByDealAndPhase(
    dealId: string,
    phase: DiligencePhase
): Promise<AgentOutput[]> {
    return query<AgentOutput>(
        `SELECT * FROM agent_outputs WHERE deal_id = $1 AND phase = $2 ORDER BY created_at`,
        [dealId, phase]
    );
}

export async function getOutputsByRunAndPhase(
    runId: string,
    phase: DiligencePhase
): Promise<AgentOutput[]> {
    return query<AgentOutput>(
        `SELECT * FROM agent_outputs WHERE run_id = $1 AND phase = $2 ORDER BY created_at`,
        [runId, phase]
    );
}

export async function getLatestOutputByDealAgentPhase(
    dealId: string,
    agentKey: string,
    phase: DiligencePhase
): Promise<AgentOutput | null> {
    return queryOne<AgentOutput>(
        `SELECT * FROM agent_outputs
         WHERE deal_id = $1 AND agent_key = $2 AND phase = $3
         ORDER BY created_at DESC LIMIT 1`,
        [dealId, agentKey, phase]
    );
}

export async function getLatestResearchOutputs(dealId: string): Promise<AgentOutput[]> {
    return query<AgentOutput>(
        `SELECT DISTINCT ON (agent_key) *
         FROM agent_outputs
         WHERE deal_id = $1 AND phase = 'research'
         ORDER BY agent_key, created_at DESC`,
        [dealId]
    );
}

export async function getLatestVerification(dealId: string): Promise<AgentOutput | null> {
    return queryOne<AgentOutput>(
        `SELECT * FROM agent_outputs
         WHERE deal_id = $1 AND phase = 'verification'
         ORDER BY created_at DESC LIMIT 1`,
        [dealId]
    );
}

export async function getLatestScorecard(dealId: string): Promise<AgentOutput | null> {
    return queryOne<AgentOutput>(
        `SELECT * FROM agent_outputs
         WHERE deal_id = $1 AND phase = 'scorecard'
         ORDER BY created_at DESC LIMIT 1`,
        [dealId]
    );
}

export async function getLatestMemo(dealId: string): Promise<AgentOutput | null> {
    return queryOne<AgentOutput>(
        `SELECT * FROM agent_outputs
         WHERE deal_id = $1 AND phase = 'memo'
         ORDER BY created_at DESC LIMIT 1`,
        [dealId]
    );
}

export async function deleteOutputsForRun(runId: string): Promise<number> {
    return execute('DELETE FROM agent_outputs WHERE run_id = $1', [runId]);
}
