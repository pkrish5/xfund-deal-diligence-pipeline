import { query, queryOne, execute } from '../client.js';

export interface Integration {
    id: string;
    tenant_id: string;
    kind: 'gcal' | 'asana' | 'notion' | 'llm';
    config: Record<string, any>;
    created_at: Date;
    updated_at: Date;
}

export async function getIntegration(
    tenantId: string,
    kind: Integration['kind']
): Promise<Integration | null> {
    return queryOne<Integration>(
        'SELECT * FROM integrations WHERE tenant_id = $1 AND kind = $2',
        [tenantId, kind]
    );
}

export async function upsertIntegration(input: {
    tenantId: string;
    kind: Integration['kind'];
    config: Record<string, any>;
}): Promise<Integration> {
    const row = await queryOne<Integration>(
        `INSERT INTO integrations (tenant_id, kind, config)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, kind)
     DO UPDATE SET config = integrations.config || EXCLUDED.config, updated_at = now()
     RETURNING *`,
        [input.tenantId, input.kind, JSON.stringify(input.config)]
    );
    return row!;
}

export async function updateIntegrationConfig(
    tenantId: string,
    kind: Integration['kind'],
    configPatch: Record<string, any>
): Promise<void> {
    await execute(
        `UPDATE integrations SET config = config || $1::jsonb, updated_at = now()
     WHERE tenant_id = $2 AND kind = $3`,
        [JSON.stringify(configPatch), tenantId, kind]
    );
}
