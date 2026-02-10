import { queryOne, execute } from '../client.js';

/**
 * Attempt to claim an idempotency key.
 * Returns true if the key was freshly inserted (proceed with work).
 * Returns false if the key already existed (skip duplicate work).
 */
export async function claimKey(key: string): Promise<boolean> {
    const row = await queryOne<{ key: string }>(
        `INSERT INTO idempotency_keys (key) VALUES ($1)
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
        [key]
    );
    return row !== null;
}

/**
 * Check if a key exists without claiming it.
 */
export async function keyExists(key: string): Promise<boolean> {
    const row = await queryOne<{ key: string }>(
        'SELECT key FROM idempotency_keys WHERE key = $1',
        [key]
    );
    return row !== null;
}

/**
 * Generate idempotency key for a GCal webhook ping.
 */
export function gcalPingKey(channelId: string, messageNumber: string): string {
    return `gcal_ping:${channelId}:${messageNumber}`;
}

/**
 * Generate idempotency key for an Asana webhook event.
 */
export function asanaEventKey(
    webhookGid: string,
    resourceGid: string,
    action: string,
    createdAt: string
): string {
    return `asana_evt:${webhookGid}:${createdAt}:${resourceGid}:${action}`;
}

/**
 * Generate idempotency key for a stage action.
 */
export function stageActionKey(
    taskGid: string,
    sectionGid: string,
    modifiedAt: string
): string {
    return `stage:${taskGid}:${sectionGid}:${modifiedAt}`;
}

/**
 * Clean up idempotency keys older than the given number of days.
 */
export async function cleanupOldKeys(olderThanDays: number = 7): Promise<number> {
    return execute(
        `DELETE FROM idempotency_keys WHERE created_at < now() - interval '1 day' * $1`,
        [olderThanDays]
    );
}
