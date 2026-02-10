import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
    logger,
    GCalClient,
    gcalWatchesRepo,
    getSecret,
} from '@xfund/shared';

export const gcalWatchRouter = Router();

const DEFAULT_TENANT_ID = process.env.TENANT_ID || '00000000-0000-0000-0000-000000000001';

async function getGCalClient(): Promise<GCalClient> {
    const clientId = await getSecret('GCAL_OAUTH_CLIENT_ID');
    const clientSecret = await getSecret('GCAL_OAUTH_CLIENT_SECRET');
    const refreshToken = await getSecret('GCAL_REFRESH_TOKEN');
    return new GCalClient({ clientId, clientSecret, refreshToken });
}

/**
 * POST /admin/gcal/watch/start
 * Create initial watch channel, store resourceId, expiration, and initialize syncToken.
 */
gcalWatchRouter.post('/start', async (req: Request, res: Response) => {
    try {
        const {
            calendarId = process.env.CALENDAR_ID || 'primary',
            channelToken,
        } = req.body;

        const tenantId = req.body.tenantId || DEFAULT_TENANT_ID;
        const channelId = `gcal-${randomUUID()}`;
        const webhookUrl = `${process.env.INGRESS_PUBLIC_BASE_URL}/webhooks/gcal`;

        const gcal = await getGCalClient();

        logger.info('Creating GCal watch', { calendarId, channelId, webhookUrl });

        // Create the watch channel
        const watchResult = await gcal.watchEvents(calendarId, webhookUrl, channelId, channelToken);

        // Store in DB
        await gcalWatchesRepo.createWatch({
            tenantId,
            calendarId,
            channelId: watchResult.channelId,
            resourceId: watchResult.resourceId,
            expirationMs: watchResult.expirationMs,
            channelToken,
        });

        // Perform initial full sync to get syncToken
        logger.info('Running initial full sync for syncToken', { calendarId });
        const syncResult = await gcal.fullSync(calendarId);

        if (syncResult.nextSyncToken) {
            await gcalWatchesRepo.updateSyncToken(watchResult.channelId, syncResult.nextSyncToken);
            logger.info('Initial sync complete', {
                eventsFound: syncResult.events.length,
                syncTokenObtained: true,
            });
        }

        res.json({
            channelId: watchResult.channelId,
            resourceId: watchResult.resourceId,
            expirationMs: watchResult.expirationMs,
            initialEventsCount: syncResult.events.length,
        });
    } catch (err: any) {
        logger.error('Failed to start GCal watch', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /admin/gcal/watch/replace
 * Replace channel before expiration (Google has no automatic renewal).
 * Steps: create new → mark old replaced → stop old channel.
 */
gcalWatchRouter.post('/replace', async (req: Request, res: Response) => {
    try {
        const calendarId = req.body.calendarId || process.env.CALENDAR_ID || 'primary';
        const tenantId = req.body.tenantId || DEFAULT_TENANT_ID;

        // Find current active watch
        const oldWatch = await gcalWatchesRepo.getActiveWatch(tenantId, calendarId);
        if (!oldWatch) {
            // No active watch — just create a new one
            logger.warn('No active watch found for replacement, creating fresh');
            res.status(404).json({ error: 'No active watch to replace. Use /start instead.' });
            return;
        }

        const gcal = await getGCalClient();
        const newChannelId = `gcal-${randomUUID()}`;
        const webhookUrl = `${process.env.INGRESS_PUBLIC_BASE_URL}/webhooks/gcal`;

        // Create new watch
        const newWatch = await gcal.watchEvents(
            calendarId,
            webhookUrl,
            newChannelId,
            oldWatch.channel_token || undefined
        );

        // Transfer syncToken from old watch
        await gcalWatchesRepo.createWatch({
            tenantId,
            calendarId,
            channelId: newWatch.channelId,
            resourceId: newWatch.resourceId,
            expirationMs: newWatch.expirationMs,
            channelToken: oldWatch.channel_token || undefined,
        });

        if (oldWatch.sync_token) {
            await gcalWatchesRepo.updateSyncToken(newWatch.channelId, oldWatch.sync_token);
        }

        // Mark old channel as replaced (keep for overlap period)
        await gcalWatchesRepo.updateWatchStatus(oldWatch.channel_id, 'replaced');

        // Stop old channel
        try {
            await gcal.stopChannel(oldWatch.channel_id, oldWatch.resource_id);
            logger.info('Old channel stopped', { oldChannelId: oldWatch.channel_id });
        } catch (stopErr: any) {
            // Non-fatal: channel may already be expired
            logger.warn('Failed to stop old channel (may be expired)', {
                oldChannelId: oldWatch.channel_id,
                error: stopErr.message,
            });
        }

        res.json({
            newChannelId: newWatch.channelId,
            newResourceId: newWatch.resourceId,
            newExpirationMs: newWatch.expirationMs,
            oldChannelId: oldWatch.channel_id,
        });
    } catch (err: any) {
        logger.error('Failed to replace GCal watch', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /admin/gcal/watch/stop
 * Stop watch via channels.stop and mark in DB.
 */
gcalWatchRouter.post('/stop', async (req: Request, res: Response) => {
    try {
        const { channelId } = req.body;
        if (!channelId) {
            res.status(400).json({ error: 'channelId is required' });
            return;
        }

        const watch = await gcalWatchesRepo.getWatchByChannelId(channelId);
        if (!watch) {
            res.status(404).json({ error: 'Watch not found' });
            return;
        }

        const gcal = await getGCalClient();
        await gcal.stopChannel(watch.channel_id, watch.resource_id);
        await gcalWatchesRepo.updateWatchStatus(channelId, 'stopped');

        logger.info('GCal watch stopped', { channelId });

        res.json({ channelId, status: 'stopped' });
    } catch (err: any) {
        logger.error('Failed to stop GCal watch', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});
