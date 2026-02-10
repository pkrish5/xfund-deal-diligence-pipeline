import { Router, Request, Response } from 'express';
import {
    logger,
    AsanaClient,
    integrationsRepo,
    getSecret,
} from '@xfund/shared';

export const asanaWebhookAdminRouter = Router();

const DEFAULT_TENANT_ID = process.env.TENANT_ID || '00000000-0000-0000-0000-000000000001';

async function getAsanaClient(): Promise<AsanaClient> {
    const token = await getSecret('ASANA_TOKEN');
    return new AsanaClient({ token });
}

/**
 * POST /admin/asana/webhook/create
 * Create webhook subscription on Asana project.
 * Asana will POST to the ingress webhook URL with X-Hook-Secret for handshake.
 */
asanaWebhookAdminRouter.post('/create', async (req: Request, res: Response) => {
    try {
        const projectGid = req.body.projectGid || process.env.ASANA_PROJECT_GID;
        if (!projectGid) {
            res.status(400).json({ error: 'projectGid is required' });
            return;
        }

        const targetUrl = `${process.env.INGRESS_PUBLIC_BASE_URL}/webhooks/asana`;
        const asana = await getAsanaClient();

        logger.info('Creating Asana webhook', { projectGid, targetUrl });

        const webhook = await asana.createWebhook(projectGid, targetUrl);

        // Store webhook GID in integrations config
        await integrationsRepo.updateIntegrationConfig(DEFAULT_TENANT_ID, 'asana', {
            webhookGid: webhook.gid,
            projectGid,
        });

        logger.info('Asana webhook created', { webhookGid: webhook.gid });

        res.json({
            webhookGid: webhook.gid,
            target: webhook.target,
            active: webhook.active,
        });
    } catch (err: any) {
        logger.error('Failed to create Asana webhook', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /admin/asana/webhook/delete
 * Delete an Asana webhook subscription.
 */
asanaWebhookAdminRouter.post('/delete', async (req: Request, res: Response) => {
    try {
        const { webhookGid } = req.body;
        if (!webhookGid) {
            res.status(400).json({ error: 'webhookGid is required' });
            return;
        }

        const asana = await getAsanaClient();
        await asana.deleteWebhook(webhookGid);

        // Clear from integrations config
        await integrationsRepo.updateIntegrationConfig(DEFAULT_TENANT_ID, 'asana', {
            webhookGid: null,
        });

        logger.info('Asana webhook deleted', { webhookGid });

        res.json({ webhookGid, status: 'deleted' });
    } catch (err: any) {
        logger.error('Failed to delete Asana webhook', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});
