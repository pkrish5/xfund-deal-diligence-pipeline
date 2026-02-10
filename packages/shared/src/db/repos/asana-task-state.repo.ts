import { queryOne, execute } from '../client.js';

export interface AsanaTaskState {
    id: string;
    tenant_id: string;
    task_gid: string;
    project_gid: string;
    last_seen_section_gid: string | null;
    last_processed_modified_at: Date | null;
    last_triggered_stage: string | null;
    updated_at: Date;
}

export interface SectionChangeResult {
    changed: boolean;
    previousSectionGid: string | null;
    previousStage: string | null;
}

/**
 * Upsert the task state and detect if the section has changed.
 * Returns whether a section change occurred.
 */
export async function upsertAndDetectChange(input: {
    tenantId: string;
    taskGid: string;
    projectGid: string;
    currentSectionGid: string;
    modifiedAt: Date;
}): Promise<SectionChangeResult> {
    // Get existing state
    const existing = await queryOne<AsanaTaskState>(
        `SELECT * FROM asana_task_state
     WHERE tenant_id = $1 AND task_gid = $2 AND project_gid = $3`,
        [input.tenantId, input.taskGid, input.projectGid]
    );

    const previousSectionGid = existing?.last_seen_section_gid ?? null;
    const previousStage = existing?.last_triggered_stage ?? null;
    const changed = previousSectionGid !== null && previousSectionGid !== input.currentSectionGid;

    // Upsert (always update to latest)
    await execute(
        `INSERT INTO asana_task_state (tenant_id, task_gid, project_gid, last_seen_section_gid, last_processed_modified_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, task_gid, project_gid)
     DO UPDATE SET
       last_seen_section_gid = EXCLUDED.last_seen_section_gid,
       last_processed_modified_at = EXCLUDED.last_processed_modified_at,
       updated_at = now()`,
        [input.tenantId, input.taskGid, input.projectGid, input.currentSectionGid, input.modifiedAt]
    );

    return { changed, previousSectionGid, previousStage };
}

export async function setTriggeredStage(
    tenantId: string,
    taskGid: string,
    projectGid: string,
    stageKey: string
): Promise<void> {
    await execute(
        `UPDATE asana_task_state SET last_triggered_stage = $1, updated_at = now()
     WHERE tenant_id = $2 AND task_gid = $3 AND project_gid = $4`,
        [stageKey, tenantId, taskGid, projectGid]
    );
}

export async function getTaskState(
    tenantId: string,
    taskGid: string,
    projectGid: string
): Promise<AsanaTaskState | null> {
    return queryOne<AsanaTaskState>(
        `SELECT * FROM asana_task_state
     WHERE tenant_id = $1 AND task_gid = $2 AND project_gid = $3`,
        [tenantId, taskGid, projectGid]
    );
}
