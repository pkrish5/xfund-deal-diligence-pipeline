import { query, queryOne, execute } from '../client.js';

export interface GcalWatch {
    id: string;
    tenant_id: string;
    calendar_id: string;
    channel_id: string;
    resource_id: string;
    expiration_ms: number | null;
    channel_token: string | null;
    sync_token: string | null;
    status: 'active' | 'stopped' | 'replaced' | 'error';
    created_at: Date;
    updated_at: Date;
}

export async function createWatch(input: {
    tenantId: string;
    calendarId: string;
    channelId: string;
    resourceId: string;
    expirationMs?: number;
    channelToken?: string;
}): Promise<GcalWatch> {
    const row = await queryOne<GcalWatch>(
        `INSERT INTO gcal_watches (tenant_id, calendar_id, channel_id, resource_id, expiration_ms, channel_token)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
        [
            input.tenantId,
            input.calendarId,
            input.channelId,
            input.resourceId,
            input.expirationMs ?? null,
            input.channelToken ?? null,
        ]
    );
    return row!;
}

export async function getActiveWatch(
    tenantId: string,
    calendarId: string
): Promise<GcalWatch | null> {
    return queryOne<GcalWatch>(
        `SELECT * FROM gcal_watches
     WHERE tenant_id = $1 AND calendar_id = $2 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
        [tenantId, calendarId]
    );
}

export async function getWatchByChannelId(channelId: string): Promise<GcalWatch | null> {
    return queryOne<GcalWatch>(
        `SELECT * FROM gcal_watches WHERE channel_id = $1 AND status IN ('active', 'replaced')`,
        [channelId]
    );
}

export async function updateWatchStatus(
    channelId: string,
    status: GcalWatch['status']
): Promise<void> {
    await execute(
        'UPDATE gcal_watches SET status = $1, updated_at = now() WHERE channel_id = $2',
        [status, channelId]
    );
}

export async function updateSyncToken(channelId: string, syncToken: string): Promise<void> {
    await execute(
        'UPDATE gcal_watches SET sync_token = $1, updated_at = now() WHERE channel_id = $2',
        [syncToken, channelId]
    );
}

export async function getActiveWatchesForCalendar(calendarId: string): Promise<GcalWatch[]> {
    return query<GcalWatch>(
        `SELECT * FROM gcal_watches WHERE calendar_id = $1 AND status = 'active' ORDER BY created_at DESC`,
        [calendarId]
    );
}

export async function cleanupExpiredWatches(olderThanHours: number = 24): Promise<number> {
    return execute(
        `DELETE FROM gcal_watches
     WHERE status IN ('stopped', 'replaced')
     AND updated_at < now() - interval '1 hour' * $1`,
        [olderThanHours]
    );
}
