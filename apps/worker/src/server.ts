import 'dotenv/config';
import express from 'express';
import { logger, requestContext, requireAuth, runMigrations } from '@xfund/shared';
import { dispatchRouter } from './routes/dispatch.js';

const app = express();
const PORT = parseInt(process.env.PORT || '8082', 10);

// Middleware
app.use(requestContext());
app.use(express.json({ limit: '10mb' })); // Research results can be large
app.use(requireAuth());

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'diligence-worker', timestamp: new Date().toISOString() });
});

// Task dispatch route
app.use('/tasks', dispatchRouter);

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
            logger.info(`diligence-worker listening on port ${PORT}`);
        });
    } catch (err: any) {
        logger.error('Failed to start worker service', { error: err.message });
        process.exit(1);
    }
}

start();
