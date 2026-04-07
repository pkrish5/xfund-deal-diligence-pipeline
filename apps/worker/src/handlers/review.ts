import {
    logger,
    dealsRepo,
    workflowRunsRepo,
    NotionClient,
    getSecret,
} from '@xfund/shared';
import * as agentOutputsRepo from '@xfund/shared/src/db/repos/agent-outputs.repo.js';
import { runReviewer } from '@xfund/shared/src/agents/reviewer-agent.js';
import { createSynthesisClient } from '@xfund/shared/src/clients/synthesis-llm.client.js';
import type { ScorecardResult, VerificationResult } from '@xfund/shared/src/agents/types.js';

/**
 * REVIEW handler
 * Payload: { runId, dealId, companyName, founderName }
 *
 * Runs the devil's advocate reviewer on the scorecard + memo.
 * Appends critique and confidence score to the Notion memo page.
 * Flags for human review if confidence is below threshold.
 */
export async function handleReview(
    tenantId: string,
    payload: {
        runId: string;
        dealId: string;
        companyName: string;
        founderName: string;
    }
): Promise<void> {
    const { runId, dealId, companyName, founderName } = payload;
    const log = logger.child({ tenantId, runId, dealId, jobType: 'REVIEW' });

    const isCancelled = await workflowRunsRepo.isCancelRequested(runId);
    if (isCancelled) {
        log.info('Review cancelled before start');
        return;
    }

    log.info('Starting devil\'s advocate review', { companyName });

    // Load scorecard, memo, and verification from DB
    const scorecardRow = await agentOutputsRepo.getLatestScorecard(dealId);
    const memoRow = await agentOutputsRepo.getLatestMemo(dealId);
    const verificationRow = await agentOutputsRepo.getLatestVerification(dealId);

    if (!scorecardRow || !memoRow) {
        log.error('Scorecard or memo not found — cannot review', { dealId });
        return;
    }

    const scorecard = scorecardRow.output as ScorecardResult;
    const memoMarkdown = memoRow.raw_response || JSON.stringify(memoRow.output);
    const verification = (verificationRow?.output || {
        contradictions: [],
        unsupportedClaims: [],
        scoreAdjustments: [],
        gaps: [],
        overallEvidenceQuality: 'weak',
        humanReviewFlags: [],
        summary: 'No verification available.',
    }) as VerificationResult;

    const synthesisClient = await createSynthesisClient(getSecret);

    const result = await runReviewer(synthesisClient, {
        scorecard,
        memoMarkdown,
        verification,
        companyName,
        founderName,
    });

    log.info('Review complete', {
        confidenceScore: result.review.confidenceScore,
        recommendationSupported: result.review.recommendationSupported,
        challenges: result.review.challenges.length,
        requiresHumanReview: result.review.requiresHumanReview,
        tokensUsed: result.tokensUsed,
    });

    // Store review result
    await agentOutputsRepo.saveOutput({
        runId,
        dealId,
        agentKey: 'reviewer',
        phase: 'review',
        output: result.review as any,
        rawResponse: result.rawResponse,
        modelUsed: synthesisClient.getModelName(),
        tokensUsed: result.tokensUsed,
    });

    // Append review to Notion memo page
    const deal = await dealsRepo.getDealById(dealId);
    if (deal?.notion_urls) {
        try {
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
                const r = result.review;

                const blocks: any[] = [
                    notion.divider(),
                    notion.heading2("Devil's Advocate Review"),
                ];

                // Confidence badge
                const emoji = r.confidenceScore >= 80 ? '🟢' : r.confidenceScore >= 60 ? '🟡' : '🔴';
                blocks.push(notion.callout(
                    `Confidence Score: ${r.confidenceScore}/100 | Recommendation ${r.recommendationSupported ? 'SUPPORTED' : 'CHALLENGED'}`,
                    emoji
                ));

                // Human review warning
                if (r.requiresHumanReview) {
                    blocks.push(notion.callout(
                        `HUMAN REVIEW REQUIRED: ${r.humanReviewReasons.join('; ')}`,
                        '🚨'
                    ));
                }

                // Challenges
                if (r.challenges.length > 0) {
                    blocks.push(notion.heading3('Challenges to Investment Thesis'));
                    for (const c of r.challenges) {
                        const severity = c.severity === 'critical' ? '🔴' : c.severity === 'significant' ? '🟠' : '🟡';
                        blocks.push(notion.bulletedList(
                            `${severity} [${c.severity.toUpperCase()}] ${c.area}: ${c.challenge}`
                        ));
                        if (c.evidenceGap) {
                            blocks.push(notion.paragraph(`   Evidence gap: ${c.evidenceGap}`));
                        }
                    }
                }

                // Devil's advocate case
                if (r.devilsAdvocateCase) {
                    blocks.push(notion.heading3('The Case Against Investing'));
                    const paragraphs = r.devilsAdvocateCase.split('\n\n').filter(Boolean);
                    for (const p of paragraphs) {
                        blocks.push(notion.paragraph(p.slice(0, 2000)));
                    }
                }

                // Missing diligence
                if (r.missingDiligence.length > 0) {
                    blocks.push(notion.heading3('Missing Diligence Items'));
                    for (const item of r.missingDiligence) {
                        blocks.push(notion.todo(item, false));
                    }
                }

                // Overall assessment
                if (r.overallAssessment) {
                    blocks.push(notion.heading3('Overall Assessment'));
                    blocks.push(notion.paragraph(r.overallAssessment.slice(0, 2000)));
                }

                await notion.appendBlocks(memoPageId, blocks);
                log.info('Review written to Notion memo page');
            }
        } catch (err: any) {
            log.warn('Failed to write review to Notion', { error: err.message });
        }
    }

    // Update deal home page
    if (deal?.notion_deal_page_id) {
        try {
            const notion = new NotionClient({
                token: await getSecret('NOTION_TOKEN'),
                parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
            });

            const statusEmoji = result.review.requiresHumanReview ? '⚠️' : '✅';
            await notion.appendBlocks(deal.notion_deal_page_id, [
                notion.divider(),
                notion.callout(
                    `IC Memo generated (Confidence: ${result.review.confidenceScore}/100). ${result.review.requiresHumanReview ? 'REQUIRES HUMAN REVIEW.' : 'Ready for IC presentation.'}`,
                    statusEmoji
                ),
            ]);
        } catch (err: any) {
            log.warn('Failed to update deal home page', { error: err.message });
        }
    }
}

function extractPageId(urlOrId: string): string {
    const match = urlOrId.match(/([a-f0-9]{32})/);
    return match ? match[1] : urlOrId;
}
