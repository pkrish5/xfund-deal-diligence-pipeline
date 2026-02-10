import { Router, Request, Response } from 'express';
import {
    logger,
    integrationsRepo,
    createTasksEnqueuer,
    AsanaClient,
} from '@xfund/shared';

export const asanaWebhookRouter = Router();

const tasksEnqueuer = createTasksEnqueuer();
const DEFAULT_TENANT_ID = process.env.TENANT_ID || '00000000-0000-0000-0000-000000000001';

/**
 * POST /webhooks/asana
 *
 * Handles two modes:
 * 1. HANDSHAKE: Asana sends X-Hook-Secret header. We must echo it back 200/204.
 * 2. EVENTS: Asana sends events with X-Hook-Signature (HMAC-SHA256 over raw body).
 *
 * Raw body parsing is configured in server.ts for this route.
 */
asanaWebhookRouter.post('/', async (req: Request, res: Response) => {
    const hookSecret = req.headers['x-hook-secret'] as string | undefined;
    const hookSignature = req.headers['x-hook-signature'] as string | undefined;

    // ---- HANDSHAKE MODE ----
    if (hookSecret) {
        logger.info('Asana webhook: handshake received', { hookSecret: hookSecret.substring(0, 8) + '...' });

        try {
            // Store the X-Hook-Secret for future signature verification
            await integrationsRepo.upsertIntegration({
                tenantId: DEFAULT_TENANT_ID,
                kind: 'asana',
                config: { webhookSecret: hookSecret },
            });

            // Echo back the secret header — this completes the handshake
            res.setHeader('X-Hook-Secret', hookSecret);
            res.status(200).send();
            return;
        } catch (err: any) {
            logger.error('Asana webhook: handshake storage error', { error: err.message });
            // Still respond to complete handshake
            res.setHeader('X-Hook-Secret', hookSecret);
            res.status(200).send();
            return;
        }
    }

    // ---- EVENTS MODE ----
    try {
        // Get stored secret for signature verification
        const integration = await integrationsRepo.getIntegration(DEFAULT_TENANT_ID, 'asana');
        const storedSecret = integration?.config?.webhookSecret;

        if (!storedSecret) {
            logger.warn('Asana webhook: no stored secret found, cannot verify signature');
            res.status(401).json({ error: 'Webhook not configured' });
            return;
        }

        // Verify signature
        const rawBody = req.body as Buffer;

        if (!hookSignature) {
            logger.warn('Asana webhook: missing X-Hook-Signature');
            res.status(401).json({ error: 'Missing signature' });
            return;
        }

        const isValid = AsanaClient.verifySignature(rawBody, hookSignature, storedSecret);
        if (!isValid) {
            logger.warn('Asana webhook: invalid signature');
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }

        // Parse the body
        const body = JSON.parse(rawBody.toString());
        const events = body.events || [];

        if (events.length === 0) {
            // Heartbeat — respond 200 quickly
            logger.info('Asana webhook: heartbeat received');
            res.status(200).send();
            return;
        }

        // Process events: enqueue ASANA_PROCESS for each relevant task event
        const projectGid = process.env.ASANA_PROJECT_GID || '';

        for (const event of events) {
            // We care about task changes (especially memberships/section changes)
            if (event.resource?.resource_type !== 'task') {
                continue;
            }

            const taskGid = event.resource?.gid;
            if (!taskGid) continue;

            await tasksEnqueuer.enqueue({
                jobType: 'ASANA_PROCESS',
                tenantId: DEFAULT_TENANT_ID,
                payload: {
                    taskGid,
                    projectGid,
                    action: event.action,
                    parentGid: event.parent?.gid,
                },
            });

            logger.info('Asana webhook: ASANA_PROCESS task enqueued', {
                taskGid,
                action: event.action,
            });
        }

        res.status(200).send();
    } catch (err: any) {
        logger.error('Asana webhook handler error', { error: err.message });
        // Always respond 200 to avoid Asana deactivating the webhook
        res.status(200).send();
    }
});
