import { query, queryOne, execute } from '../client.js';

export interface WorkflowRun {
    id: string;
    tenant_id: string;
    deal_id: string;
    task_gid: string | null;
    stage_key: string;
    status: 'running' | 'succeeded' | 'failed' | 'canceled';
    cancel_requested: boolean;
    started_at: Date;
    finished_at: Date | null;
    meta: Record<string, any>;
}

export async function createRun(input: {
    tenantId: string;
    dealId: string;
    taskGid?: string;
    stageKey: string;
    meta?: Record<string, any>;
}): Promise<WorkflowRun> {
    const row = await queryOne<WorkflowRun>(
        `INSERT INTO workflow_runs (tenant_id, deal_id, task_gid, stage_key, meta)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
        [
            input.tenantId,
            input.dealId,
            input.taskGid ?? null,
            input.stageKey,
            JSON.stringify(input.meta ?? {}),
        ]
    );
    return row!;
}

export async function getRunById(runId: string): Promise<WorkflowRun | null> {
    return queryOne<WorkflowRun>('SELECT * FROM workflow_runs WHERE id = $1', [runId]);
}

export async function getRunningRunsForDeal(dealId: string): Promise<WorkflowRun[]> {
    return query<WorkflowRun>(
        `SELECT * FROM workflow_runs WHERE deal_id = $1 AND status = 'running'`,
        [dealId]
    );
}

export async function requestCancellation(dealId: string): Promise<number> {
    return execute(
        `UPDATE workflow_runs SET cancel_requested = true
     WHERE deal_id = $1 AND status = 'running'`,
        [dealId]
    );
}

export async function isCancelRequested(runId: string): Promise<boolean> {
    const row = await queryOne<{ cancel_requested: boolean }>(
        'SELECT cancel_requested FROM workflow_runs WHERE id = $1',
        [runId]
    );
    return row?.cancel_requested ?? false;
}

export async function completeRun(
    runId: string,
    status: 'succeeded' | 'failed' | 'canceled',
    meta?: Record<string, any>
): Promise<void> {
    const metaUpdate = meta ? `, meta = meta || $3::jsonb` : '';
    const params: any[] = [status, runId];
    if (meta) params.push(JSON.stringify(meta));

    await execute(
        `UPDATE workflow_runs SET status = $1, finished_at = now()${metaUpdate} WHERE id = $2`,
        params
    );
}
