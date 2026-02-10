import 'dotenv/config';
import express from 'express';
import { logger, requestContext, runMigrations } from '@xfund/shared';
import { gcalWebhookRouter } from './routes/gcal-webhook.js';
import { asanaWebhookRouter } from './routes/asana-webhook.js';

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

// Request context extraction (trace IDs etc)
app.use(requestContext());

// Raw body parsing for HMAC verification (Asana needs raw buffer)
app.use('/webhooks/asana', express.raw({ type: 'application/json' }));

// Standard JSON parsing for other routes
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'diligence-ingress', timestamp: new Date().toISOString() });
});

// Webhook routes
app.use('/webhooks/gcal', gcalWebhookRouter);
app.use('/webhooks/asana', asanaWebhookRouter);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
});

async function start() {
    try {
        // Run migrations on startup
        await runMigrations();
        logger.info('Database migrations completed');

        app.listen(PORT, () => {
            logger.info(`diligence-ingress listening on port ${PORT}`);
        });
    } catch (err: any) {
        logger.error('Failed to start ingress service', { error: err.message });
        process.exit(1);
    }
}

start();
