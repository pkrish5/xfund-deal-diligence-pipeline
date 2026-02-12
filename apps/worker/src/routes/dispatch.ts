import { Router, Request, Response } from 'express';
import { logger, type JobType } from '@xfund/shared';
import { handleGcalSync } from '../handlers/gcal-sync.js';
import { handleAsanaProcess } from '../handlers/asana-process.js';
import { handleStageAction } from '../handlers/stage-action.js';
import { handleResearchAgent } from '../handlers/research-agent.js';
import { handleResearchBatch } from '../handlers/research-batch.js';
import { handleMemoGenerate } from '../handlers/memo-generate.js';

export const dispatchRouter = Router();

type Handler = (tenantId: string, payload: any) => Promise<void>;

const HANDLERS: Record<JobType, Handler> = {
    GCAL_SYNC: handleGcalSync,
    ASANA_PROCESS: handleAsanaProcess,
    STAGE_ACTION: handleStageAction,
    RESEARCH_AGENT: handleResearchAgent,
    RESEARCH_BATCH: handleResearchBatch,
    MEMO_GENERATE: handleMemoGenerate,
};

/**
 * POST /tasks/dispatch
 * Central dispatch endpoint for all Cloud Tasks jobs.
 * Body: { jobType, tenantId, payload, idempotencyKey? }
 */
dispatchRouter.post('/dispatch', async (req: Request, res: Response) => {
    const { jobType, tenantId, payload, idempotencyKey } = req.body;

    const log = logger.child({ jobType, tenantId, idempotencyKey });

    if (!jobType || !tenantId || !payload) {
        log.warn('Invalid task dispatch request');
        res.status(400).json({ error: 'jobType, tenantId, and payload are required' });
        return;
    }

    const handler = HANDLERS[jobType as JobType];
    if (!handler) {
        log.warn('Unknown job type', { jobType });
        res.status(400).json({ error: `Unknown job type: ${jobType}` });
        return;
    }

    log.info(`Processing task: ${jobType}`);

    try {
        await handler(tenantId, payload);
        log.info(`Task completed: ${jobType}`);
        res.status(200).json({ status: 'ok' });
    } catch (err: any) {
        log.error(`Task failed: ${jobType}`, { error: err.message, stack: err.stack });
        // Return 500 so Cloud Tasks retries the task
        res.status(500).json({ error: err.message });
    }
});
