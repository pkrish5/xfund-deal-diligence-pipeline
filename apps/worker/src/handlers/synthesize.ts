import {
    logger,
    dealsRepo,
    workflowRunsRepo,
    createTasksEnqueuer,
    NotionClient,
    getSecret,
} from '@xfund/shared';
import * as agentOutputsRepo from '@xfund/shared/src/db/repos/agent-outputs.repo.js';
import { runSynthesis } from '@xfund/shared/src/agents/synthesis-agent.js';
import { createSynthesisClient } from '@xfund/shared/src/clients/synthesis-llm.client.js';
import type { DomainAgentOutput, VerificationResult } from '@xfund/shared/src/agents/types.js';

const tasksEnqueuer = createTasksEnqueuer();

/**
 * SYNTHESIZE handler
 * Payload: { runId, dealId, companyName, founderName }
 *
 * 1. Reads research outputs + verification from DB
 * 2. Generates scorecard (structured JSON)
 * 3. Generates IC memo (narrative markdown) using scorecard
 * 4. Writes memo to Notion
 * 5. Chains to REVIEW
 */
export async function handleSynthesize(
    tenantId: string,
    payload: {
        runId: string;
        dealId: string;
        companyName: string;
        founderName: string;
    }
): Promise<void> {
    const { runId, dealId, companyName, founderName } = payload;
    const log = logger.child({ tenantId, runId, dealId, jobType: 'SYNTHESIZE' });

    const isCancelled = await workflowRunsRepo.isCancelRequested(runId);
    if (isCancelled) {
        log.info('Synthesis cancelled before start');
        return;
    }

    log.info('Starting synthesis (scorecard + memo)', { companyName });

    // Load inputs from DB
    const researchOutputs = await agentOutputsRepo.getLatestResearchOutputs(dealId);
    const verificationRow = await agentOutputsRepo.getLatestVerification(dealId);

    if (researchOutputs.length === 0) {
        log.error('No research outputs found — cannot synthesize', { dealId });
        return;
    }

    const agentOutputs = researchOutputs.map((r: any) => ({
        agentKey: r.agent_key,
        output: r.output as DomainAgentOutput,
    }));

    const verification = (verificationRow?.output || {
        contradictions: [],
        unsupportedClaims: [],
        scoreAdjustments: [],
        gaps: ['No verification was run'],
        overallEvidenceQuality: 'weak',
        humanReviewFlags: ['Verification not available'],
        summary: 'Verification step was not completed.',
    }) as VerificationResult;

    // Fetch meeting notes from Notion
    let meetingNotes = '';
    const deal = await dealsRepo.getDealById(dealId);
    if (deal?.notion_urls) {
        try {
            const notionUrls = typeof deal.notion_urls === 'string'
                ? JSON.parse(deal.notion_urls)
                : deal.notion_urls;

            if (notionUrls.meetingNotes) {
                const notion = new NotionClient({
                    token: await getSecret('NOTION_TOKEN'),
                    parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
                });
                const match = notionUrls.meetingNotes.match(/([a-f0-9]{32})/);
                if (match) {
                    meetingNotes = await notion.getPageContent(match[1]);
                    log.info('Fetched meeting notes', { length: meetingNotes.length });
                }
            }
        } catch (err: any) {
            log.warn('Failed to fetch meeting notes', { error: err.message });
        }
    }

    // Run synthesis
    const synthesisClient = await createSynthesisClient(getSecret);

    const abortController = new AbortController();
    const cancelCheck = setInterval(async () => {
        try {
            if (await workflowRunsRepo.isCancelRequested(runId)) {
                abortController.abort();
                clearInterval(cancelCheck);
            }
        } catch {}
    }, 5000);

    try {
        const result = await runSynthesis(synthesisClient, {
            agentOutputs,
            verification,
            meetingNotes,
            companyName,
            founderName,
            signal: abortController.signal,
        });

        log.info('Synthesis complete', {
            overallScore: result.scorecard.overallScore,
            recommendation: result.scorecard.overallRecommendation,
            memoSections: result.memo.sections.length,
            totalTokens: result.totalTokens,
        });

        // Store scorecard
        await agentOutputsRepo.saveOutput({
            runId,
            dealId,
            agentKey: 'synthesis',
            phase: 'scorecard',
            output: result.scorecard as any,
            modelUsed: synthesisClient.getModelName(),
            tokensUsed: result.totalTokens,
        });

        // Store memo
        await agentOutputsRepo.saveOutput({
            runId,
            dealId,
            agentKey: 'synthesis',
            phase: 'memo',
            output: { title: result.memo.title, sections: result.memo.sections } as any,
            rawResponse: result.rawMemoMarkdown,
            modelUsed: synthesisClient.getModelName(),
        });

        // Write memo to Notion
        if (deal?.notion_urls) {
            const notionUrls = typeof deal.notion_urls === 'string'
                ? JSON.parse(deal.notion_urls)
                : deal.notion_urls;

            const memoPageUrl = notionUrls.memo;
            if (memoPageUrl) {
                const notion = new NotionClient({
                    token: await getSecret('NOTION_TOKEN'),
                    parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
                });

                const memoPageId = extractPageId(memoPageUrl);
                const sc = result.scorecard;

                const blocks: any[] = [];

                // Scorecard header
                blocks.push(notion.heading2(result.memo.title));
                blocks.push(notion.callout(
                    `Overall: ${sc.overallScore} — ${sc.overallRecommendation} | Evidence: ${verification.overallEvidenceQuality}`,
                    sc.overallRecommendation === 'PASS' || sc.overallRecommendation === 'LEAN_PASS' ? '🔴' :
                    sc.overallRecommendation === 'MORE_INFO' ? '🟡' : '🟢'
                ));

                // Domain scores
                if (sc.domainScores.length > 0) {
                    blocks.push(notion.heading3('Scorecard'));
                    for (const ds of sc.domainScores) {
                        const adjusted = ds.adjustedScore && ds.adjustedScore !== ds.score
                            ? ` (adjusted: ${ds.adjustedScore})`
                            : '';
                        blocks.push(notion.bulletedList(
                            `${ds.domain}: ${ds.score}${adjusted} — ${ds.keyFinding}`
                        ));
                    }
                }

                blocks.push(notion.divider());

                // Memo sections
                for (const section of result.memo.sections) {
                    blocks.push(notion.heading3(section.heading));
                    const paragraphs = section.content.split('\n\n').filter(Boolean);
                    for (const p of paragraphs) {
                        const contentBlocks = notion.markdownToBlocks(p);
                        blocks.push(...contentBlocks);
                    }
                }

                blocks.push(notion.divider());
                blocks.push(notion.callout(
                    `Generated on ${new Date().toLocaleDateString()} | Model: ${synthesisClient.getModelName()} | This memo was AI-generated. Review before IC presentation.`,
                    '📄'
                ));

                await notion.appendBlocks(memoPageId, blocks);
                log.info('Memo written to Notion');
            }
        }

        // Chain to REVIEW
        await tasksEnqueuer.enqueue({
            jobType: 'REVIEW',
            tenantId,
            payload: { runId, dealId, companyName, founderName },
        });
        log.info('Review step enqueued');

    } catch (err: any) {
        if (err.name === 'AbortError') {
            log.info('Synthesis aborted due to cancellation');
            return;
        }
        throw err;
    } finally {
        clearInterval(cancelCheck);
    }
}

function extractPageId(urlOrId: string): string {
    const match = urlOrId.match(/([a-f0-9]{32})/);
    return match ? match[1] : urlOrId;
}
