import { query, queryOne, execute } from '../client.js';

export type StageKey = 'FIRST_MEETING' | 'IN_DILIGENCE' | 'IC_REVIEW' | 'PASS' | 'ARCHIVE';

export interface PipelineSection {
    id: string;
    tenant_id: string;
    project_gid: string;
    section_gid: string;
    stage_key: StageKey;
    enabled: boolean;
}

export async function getStageForSection(
    tenantId: string,
    projectGid: string,
    sectionGid: string
): Promise<StageKey | null> {
    const row = await queryOne<PipelineSection>(
        `SELECT * FROM pipeline_sections
     WHERE tenant_id = $1 AND project_gid = $2 AND section_gid = $3 AND enabled = true`,
        [tenantId, projectGid, sectionGid]
    );
    return row?.stage_key ?? null;
}

export async function getAllSections(
    tenantId: string,
    projectGid: string
): Promise<PipelineSection[]> {
    return query<PipelineSection>(
        `SELECT * FROM pipeline_sections WHERE tenant_id = $1 AND project_gid = $2 ORDER BY stage_key`,
        [tenantId, projectGid]
    );
}

export async function getSectionForStage(
    tenantId: string,
    projectGid: string,
    stageKey: StageKey
): Promise<string | null> {
    const row = await queryOne<PipelineSection>(
        `SELECT * FROM pipeline_sections
     WHERE tenant_id = $1 AND project_gid = $2 AND stage_key = $3 AND enabled = true`,
        [tenantId, projectGid, stageKey]
    );
    return row?.section_gid ?? null;
}

export async function upsertSection(input: {
    tenantId: string;
    projectGid: string;
    sectionGid: string;
    stageKey: StageKey;
}): Promise<void> {
    await execute(
        `INSERT INTO pipeline_sections (tenant_id, project_gid, section_gid, stage_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, project_gid, section_gid)
     DO UPDATE SET stage_key = EXCLUDED.stage_key, enabled = true`,
        [input.tenantId, input.projectGid, input.sectionGid, input.stageKey]
    );
}
