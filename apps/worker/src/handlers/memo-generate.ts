import { logger } from '@xfund/shared';
import { handleSynthesize } from './synthesize.js';

/**
 * MEMO_GENERATE handler (v2 — delegates to SYNTHESIZE pipeline)
 *
 * This handler is kept for backward compatibility with existing
 * Cloud Tasks payloads. New pipeline uses SYNTHESIZE → REVIEW directly.
 */
export async function handleMemoGenerate(
    tenantId: string,
    payload: {
        runId: string;
        dealId: string;
        companyName: string;
        founderName: string;
    }
): Promise<void> {
    const log = logger.child({ tenantId, jobType: 'MEMO_GENERATE' });
    log.info('MEMO_GENERATE received — delegating to SYNTHESIZE pipeline');

    await handleSynthesize(tenantId, payload);
}
