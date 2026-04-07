import {
    logger,
    dealsRepo,
    workflowRunsRepo,
    getSecret,
    NotionClient,
} from '@xfund/shared';
import * as agentOutputsRepo from '@xfund/shared/src/db/repos/agent-outputs.repo.js';
import { runVerifier } from '@xfund/shared/src/agents/verifier-agent.js';
import { createSynthesisClient } from '@xfund/shared/src/clients/synthesis-llm.client.js';
import type { DomainAgentOutput } from '@xfund/shared/src/agents/types.js';

/**
 * VERIFY handler
 * Payload: { runId, dealId, companyName, founderName }
 *
 * Reads all 9 domain agent outputs from DB, runs cross-agent verification,
 * stores the result, and writes a summary to the Notion research page.
 */
export async function handleVerify(
    tenantId: string,
    payload: {
        runId: string;
        dealId: string;
        companyName: string;
        founderName: string;
    }
): Promise<void> {
    const { runId, dealId, companyName, founderName } = payload;
    const log = logger.child({ tenantId, runId, dealId, jobType: 'VERIFY' });

    const isCancelled = await workflowRunsRepo.isCancelRequested(runId);
    if (isCancelled) {
        log.info('Verification cancelled before start');
        return;
    }

    log.info('Starting cross-agent verification', { companyName });

    // Load all research outputs for this deal
    const researchOutputs = await agentOutputsRepo.getLatestResearchOutputs(dealId);
    if (researchOutputs.length === 0) {
        log.error('No research outputs found for deal', { dealId });
        return;
    }

    log.info('Loaded research outputs', { count: researchOutputs.length });

    const synthesisClient = await createSynthesisClient(getSecret);

    const agentOutputs = researchOutputs.map((r: any) => ({
        agentKey: r.agent_key,
        output: r.output as DomainAgentOutput,
    }));

    const result = await runVerifier(synthesisClient, {
        agentOutputs,
        companyName,
        founderName,
    });

    log.info('Verification complete', {
        contradictions: result.verification.contradictions.length,
        unsupportedClaims: result.verification.unsupportedClaims.length,
        evidenceQuality: result.verification.overallEvidenceQuality,
        tokensUsed: result.tokensUsed,
    });

    // Store verification result
    await agentOutputsRepo.saveOutput({
        runId,
        dealId,
        agentKey: 'verifier',
        phase: 'verification',
        output: result.verification as any,
        rawResponse: result.rawResponse,
        modelUsed: synthesisClient.getModelName(),
        tokensUsed: result.tokensUsed,
    });

    // Write verification summary to Notion research page
    const deal = await dealsRepo.getDealById(dealId);
    if (deal?.notion_urls) {
        try {
            const notionUrls = typeof deal.notion_urls === 'string'
                ? JSON.parse(deal.notion_urls)
                : deal.notion_urls;

            const researchPageId = notionUrls.research;
            if (researchPageId) {
                const notion = new NotionClient({
                    token: await getSecret('NOTION_TOKEN'),
                    parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
                });

                const pageId = extractPageId(researchPageId);
                const v = result.verification;

                const blocks: any[] = [
                    notion.divider(),
                    notion.heading2('Cross-Agent Verification Report'),
                    notion.callout(
                        `Evidence Quality: ${v.overallEvidenceQuality.toUpperCase()} | Contradictions: ${v.contradictions.length} | Unsupported Claims: ${v.unsupportedClaims.length}`,
                        v.overallEvidenceQuality === 'strong' ? '✅' : v.overallEvidenceQuality === 'moderate' ? '⚠️' : '🔴'
                    ),
                ];

                if (v.summary) {
                    blocks.push(notion.paragraph(v.summary.slice(0, 2000)));
                }

                if (v.contradictions.length > 0) {
                    blocks.push(notion.heading3('Contradictions'));
                    for (const c of v.contradictions) {
                        blocks.push(notion.bulletedList(
                            `[${c.severity.toUpperCase()}] ${c.agentA} vs ${c.agentB}: "${c.claimA}" conflicts with "${c.claimB}"${c.resolution ? ` — ${c.resolution}` : ''}`
                        ));
                    }
                }

                if (v.scoreAdjustments.length > 0) {
                    blocks.push(notion.heading3('Score Adjustments'));
                    for (const a of v.scoreAdjustments) {
                        blocks.push(notion.bulletedList(
                            `${a.agent}: ${a.originalScore} → ${a.adjustedScore} (${a.reason})`
                        ));
                    }
                }

                if (v.humanReviewFlags.length > 0) {
                    blocks.push(notion.heading3('Items for Human Review'));
                    for (const flag of v.humanReviewFlags) {
                        blocks.push(notion.todo(flag, false));
                    }
                }

                await notion.appendBlocks(pageId, blocks);
                log.info('Verification written to Notion');
            }
        } catch (err: any) {
            log.warn('Failed to write verification to Notion', { error: err.message });
        }
    }
}

function extractPageId(urlOrId: string): string {
    const match = urlOrId.match(/([a-f0-9]{32})/);
    return match ? match[1] : urlOrId;
}
