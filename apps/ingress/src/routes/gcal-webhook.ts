import { Router, Request, Response } from 'express';
import {
    logger,
    gcalWatchesRepo,
    idempotencyRepo,
    createTasksEnqueuer,
} from '@xfund/shared';

export const gcalWebhookRouter = Router();

const tasksEnqueuer = createTasksEnqueuer();

/**
 * POST /webhooks/gcal
 *
 * Google Calendar push notifications deliver HEADERS ONLY (empty body).
 * We must:
 * 1. Extract headers: X-Goog-Channel-ID, X-Goog-Resource-ID, etc.
 * 2. Validate the channel exists in our DB
 * 3. Check idempotency (skip duplicate pings)
 * 4. Enqueue GCAL_SYNC task
 * 5. Respond 200 immediately (< 200ms target)
 */
gcalWebhookRouter.post('/', async (req: Request, res: Response) => {
    const channelId = req.headers['x-goog-channel-id'] as string;
    const resourceId = req.headers['x-goog-resource-id'] as string;
    const resourceState = req.headers['x-goog-resource-state'] as string;
    const messageNumber = req.headers['x-goog-message-number'] as string;
    const channelToken = req.headers['x-goog-channel-token'] as string | undefined;

    const log = logger.child({ channelId, resourceId, resourceState, messageNumber });

    // Validate required headers
    if (!channelId || !resourceId) {
        log.warn('GCal webhook: missing required headers');
        res.status(400).json({ error: 'Missing required GCal headers' });
        return;
    }

    // Handle sync notification (sent when watch is first created)
    if (resourceState === 'sync') {
        log.info('GCal webhook: sync notification received (initial handshake)');
        res.status(200).send();
        return;
    }

    try {
        // Validate channel exists in DB
        const watch = await gcalWatchesRepo.getWatchByChannelId(channelId);
        if (!watch) {
            log.warn('GCal webhook: unknown channel_id');
            // Still return 200 to avoid Google retrying
            res.status(200).send();
            return;
        }

        // Verify resource_id matches
        if (watch.resource_id !== resourceId) {
            log.warn('GCal webhook: resource_id mismatch', {
                expected: watch.resource_id,
                received: resourceId,
            });
            res.status(200).send();
            return;
        }

        // Optional: verify channel token
        if (channelToken && watch.channel_token && channelToken !== watch.channel_token) {
            log.warn('GCal webhook: channel_token mismatch');
            res.status(200).send();
            return;
        }

        // Idempotency check
        const idempotencyKey = idempotencyRepo.gcalPingKey(channelId, messageNumber);
        const isNew = await idempotencyRepo.claimKey(idempotencyKey);
        if (!isNew) {
            log.info('GCal webhook: duplicate ping, skipping');
            res.status(200).send();
            return;
        }

        // Enqueue GCAL_SYNC task
        await tasksEnqueuer.enqueue({
            jobType: 'GCAL_SYNC',
            tenantId: watch.tenant_id,
            payload: {
                calendarId: watch.calendar_id,
                channelId: watch.channel_id,
            },
            idempotencyKey,
        });

        log.info('GCal webhook: GCAL_SYNC task enqueued');
        res.status(200).send();
    } catch (err: any) {
        log.error('GCal webhook handler error', { error: err.message });
        // Still return 200 to prevent Google from retrying
        res.status(200).send();
    }
});
