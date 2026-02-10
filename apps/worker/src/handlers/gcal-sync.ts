import {
    logger,
    GCalClient,
    gcalWatchesRepo,
    dealsRepo,
    getSecret,
    parseCalendlyEvent,
    isDealEvent,
} from '@xfund/shared';
import { createDealObject } from '../orchestrator/deal-creator.js';

/**
 * GCAL_SYNC handler
 * Payload: { calendarId, channelId }
 *
 * 1. Load active watch row, get syncToken
 * 2. If syncToken exists: incremental sync
 * 3. If syncToken missing or 410 GONE: full sync
 * 4. For each changed event: upsert deal → create Asana task + Notion workspace
 * 5. Persist new syncToken
 */
export async function handleGcalSync(
    tenantId: string,
    payload: { calendarId: string; channelId: string }
): Promise<void> {
    const { calendarId, channelId } = payload;
    const log = logger.child({ tenantId, calendarId, channelId, jobType: 'GCAL_SYNC' });

    // Get the watch record with its syncToken
    const watch = await gcalWatchesRepo.getWatchByChannelId(channelId);
    if (!watch) {
        log.warn('No watch found for channel, skipping sync');
        return;
    }

    // Initialize GCal client
    const gcal = new GCalClient({
        clientId: await getSecret('GCAL_OAUTH_CLIENT_ID'),
        clientSecret: await getSecret('GCAL_OAUTH_CLIENT_SECRET'),
        refreshToken: await getSecret('GCAL_REFRESH_TOKEN'),
    });

    let syncResult;

    if (watch.sync_token) {
        // Try incremental sync
        log.info('Starting incremental sync');
        const incrementalResult = await gcal.incrementalSync(calendarId, watch.sync_token);

        if ('goneError' in incrementalResult) {
            // SyncToken invalidated (410 GONE) → do full sync
            log.warn('SyncToken expired (410 GONE), performing full sync');
            syncResult = await gcal.fullSync(calendarId);
        } else {
            syncResult = incrementalResult;
        }
    } else {
        // No syncToken → full sync
        log.info('No syncToken found, performing full sync');
        syncResult = await gcal.fullSync(calendarId);
    }

    log.info('Sync completed', {
        eventsCount: syncResult.events.length,
        fullSync: syncResult.fullSync,
        hasSyncToken: !!syncResult.nextSyncToken,
    });

    // Process each changed event
    for (const event of syncResult.events) {
        if (!event.id) continue;

        // Skip cancelled events
        if (event.status === 'cancelled') {
            log.info('Skipping cancelled event', { eventId: event.id });
            continue;
        }

        // Only process events tagged with [deal]
        if (!isDealEvent(event)) {
            log.debug('Skipping non-deal event', { eventId: event.id, summary: event.summary });
            continue;
        }

        try {
            const parsed = parseCalendlyEvent(event);

            // Strip [deal] tag from company name so Asana/Notion titles are clean
            if (parsed.companyName) {
                parsed.companyName = parsed.companyName.replace(/\s*\[deal\]\s*/gi, '').trim();
            }

            // Upsert deal (idempotent by calendarId + eventId)
            const deal = await dealsRepo.upsertDeal({
                tenantId,
                gcalCalendarId: calendarId,
                gcalEventId: event.id,
                gcalIcalUid: event.iCalUID || undefined,
                companyName: parsed.companyName || undefined,
                founderName: parsed.founderName || undefined,
                source: 'gcal',
            });

            // If this is a new deal (no Asana task yet), create the full deal object
            if (!deal.asana_task_gid) {
                log.info('New deal detected, creating deal object', {
                    dealId: deal.id,
                    company: parsed.companyName,
                    founder: parsed.founderName,
                });

                await createDealObject(tenantId, deal.id, parsed);
            } else {
                log.info('Existing deal updated', {
                    dealId: deal.id,
                    asanaTask: deal.asana_task_gid,
                });
            }
        } catch (err: any) {
            log.error('Failed to process event', { eventId: event.id, error: err.message });
            // Continue with other events
        }
    }

    // Persist new syncToken
    if (syncResult.nextSyncToken) {
        // Update on the active watch (could be the original or a new one after replace)
        const activeWatch = await gcalWatchesRepo.getActiveWatch(tenantId, calendarId);
        if (activeWatch) {
            await gcalWatchesRepo.updateSyncToken(activeWatch.channel_id, syncResult.nextSyncToken);
        } else {
            // Fallback: update on the channel that triggered this
            await gcalWatchesRepo.updateSyncToken(channelId, syncResult.nextSyncToken);
        }
        log.info('SyncToken persisted');
    }
}
