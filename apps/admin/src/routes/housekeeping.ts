import { Router, Request, Response } from 'express';
import {
    logger,
    idempotencyRepo,
    gcalWatchesRepo,
} from '@xfund/shared';

export const housekeepingRouter = Router();

/**
 * POST /admin/housekeeping
 * Cleanup tasks run daily by Cloud Scheduler.
 */
housekeepingRouter.post('/housekeeping', async (_req: Request, res: Response) => {
    try {
        const results: Record<string, any> = {};

        // Clean up old idempotency keys (>7 days)
        const keysDeleted = await idempotencyRepo.cleanupOldKeys(7);
        results.idempotencyKeysDeleted = keysDeleted;
        logger.info('Cleaned up idempotency keys', { count: keysDeleted });

        // Clean up old stopped/replaced watches (>24h)
        const watchesDeleted = await gcalWatchesRepo.cleanupExpiredWatches(24);
        results.watchesDeleted = watchesDeleted;
        logger.info('Cleaned up expired watches', { count: watchesDeleted });

        res.json({ status: 'ok', results });
    } catch (err: any) {
        logger.error('Housekeeping failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});
