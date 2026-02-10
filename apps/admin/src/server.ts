import 'dotenv/config';
import express from 'express';
import { logger, requestContext, requireAuth, runMigrations } from '@xfund/shared';
import { gcalWatchRouter } from './routes/gcal-watch.js';
import { asanaWebhookAdminRouter } from './routes/asana-webhook-admin.js';
import { housekeepingRouter } from './routes/housekeeping.js';

const app = express();
const PORT = parseInt(process.env.PORT || '8081', 10);

// Middleware
app.use(requestContext());
app.use(express.json());
app.use(requireAuth());

// Health check (before auth for load balancer probes)
app.get('/admin/health', (_req, res) => {
    res.json({ status: 'ok', service: 'diligence-admin', timestamp: new Date().toISOString() });
});

// Admin routes
app.use('/admin/gcal/watch', gcalWatchRouter);
app.use('/admin/asana/webhook', asanaWebhookAdminRouter);
app.use('/admin', housekeepingRouter);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
});

async function start() {
    try {
        await runMigrations();
        logger.info('Database migrations completed');

        app.listen(PORT, () => {
            logger.info(`diligence-admin listening on port ${PORT}`);
        });
    } catch (err: any) {
        logger.error('Failed to start admin service', { error: err.message });
        process.exit(1);
    }
}

start();
