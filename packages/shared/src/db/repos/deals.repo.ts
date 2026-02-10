import { query, queryOne, execute } from '../client.js';

export interface Deal {
    id: string;
    tenant_id: string;
    gcal_calendar_id: string;
    gcal_event_id: string;
    gcal_ical_uid: string | null;
    company_name: string | null;
    founder_name: string | null;
    asana_task_gid: string | null;
    notion_deal_page_id: string | null;
    notion_urls: Record<string, string>;
    current_stage: string;
    source: string;
    created_at: Date;
    updated_at: Date;
}

export interface UpsertDealInput {
    tenantId: string;
    gcalCalendarId: string;
    gcalEventId: string;
    gcalIcalUid?: string;
    companyName?: string;
    founderName?: string;
    source?: string;
}

export async function upsertDeal(input: UpsertDealInput): Promise<Deal> {
    const row = await queryOne<Deal>(
        `INSERT INTO deals (tenant_id, gcal_calendar_id, gcal_event_id, gcal_ical_uid, company_name, founder_name, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, gcal_calendar_id, gcal_event_id)
     DO UPDATE SET
       gcal_ical_uid = COALESCE(EXCLUDED.gcal_ical_uid, deals.gcal_ical_uid),
       company_name = COALESCE(EXCLUDED.company_name, deals.company_name),
       founder_name = COALESCE(EXCLUDED.founder_name, deals.founder_name),
       updated_at = now()
     RETURNING *`,
        [
            input.tenantId,
            input.gcalCalendarId,
            input.gcalEventId,
            input.gcalIcalUid ?? null,
            input.companyName ?? null,
            input.founderName ?? null,
            input.source ?? 'gcal',
        ]
    );
    return row!;
}

export async function getDealById(id: string): Promise<Deal | null> {
    return queryOne<Deal>('SELECT * FROM deals WHERE id = $1', [id]);
}

export async function getDealByAsanaTask(taskGid: string): Promise<Deal | null> {
    return queryOne<Deal>('SELECT * FROM deals WHERE asana_task_gid = $1', [taskGid]);
}

export async function getDealByGcalEvent(
    tenantId: string,
    calendarId: string,
    eventId: string
): Promise<Deal | null> {
    return queryOne<Deal>(
        'SELECT * FROM deals WHERE tenant_id = $1 AND gcal_calendar_id = $2 AND gcal_event_id = $3',
        [tenantId, calendarId, eventId]
    );
}

export async function updateDealAsana(dealId: string, asanaTaskGid: string): Promise<void> {
    await execute(
        'UPDATE deals SET asana_task_gid = $1, updated_at = now() WHERE id = $2',
        [asanaTaskGid, dealId]
    );
}

export async function updateDealNotion(
    dealId: string,
    notionDealPageId: string,
    notionUrls: Record<string, string>
): Promise<void> {
    await execute(
        'UPDATE deals SET notion_deal_page_id = $1, notion_urls = $2, updated_at = now() WHERE id = $3',
        [notionDealPageId, JSON.stringify(notionUrls), dealId]
    );
}

export async function updateDealStage(dealId: string, stage: string): Promise<void> {
    await execute(
        'UPDATE deals SET current_stage = $1, updated_at = now() WHERE id = $2',
        [stage, dealId]
    );
}
