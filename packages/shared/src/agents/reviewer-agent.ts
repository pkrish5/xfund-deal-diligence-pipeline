import type {
    SynthesisLLMInterface,
    ScorecardResult,
    VerificationResult,
    ReviewResult,
} from './types.js';
import { parseJsonFromLLM } from './types.js';
import { REVIEWER_SYSTEM_PROMPT, buildReviewerUserMessage } from './prompts/reviewer.js';

export interface ReviewerInput {
    scorecard: ScorecardResult;
    memoMarkdown: string;
    verification: VerificationResult;
    companyName: string;
    founderName: string;
    signal?: AbortSignal;
}

export interface ReviewerResponse {
    review: ReviewResult;
    tokensUsed: number;
    rawResponse: string;
}

const HUMAN_REVIEW_THRESHOLD = 60;

/**
 * Reviewer Agent — Devil's Advocate
 *
 * Challenges the investment recommendation, looking for:
 * - Evidence gaps that undermine the thesis
 * - Optimism bias in scoring
 * - Logical leaps from evidence to conclusion
 * - Missing diligence items
 *
 * Produces a confidence score (0-100). Below threshold → flags for human review.
 */
export async function runReviewer(
    client: SynthesisLLMInterface,
    input: ReviewerInput
): Promise<ReviewerResponse> {
    const { scorecard, memoMarkdown, verification, companyName, founderName, signal } = input;

    const userMessage = buildReviewerUserMessage(
        scorecard, memoMarkdown, verification, companyName, founderName
    );

    const result = await client.complete({
        systemPrompt: REVIEWER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0.4,
        maxTokens: 4096,
        jsonMode: true,
        signal,
    });

    let review: ReviewResult;
    try {
        const parsed = parseJsonFromLLM<any>(result.content);
        review = validateReview(parsed);
    } catch {
        review = {
            recommendationSupported: false,
            confidenceScore: 0,
            challenges: [],
            devilsAdvocateCase: 'Review failed to produce structured output.',
            missingDiligence: ['Manual review required — automated reviewer encountered an error'],
            overallAssessment: 'Automated review could not be completed.',
            requiresHumanReview: true,
            humanReviewReasons: ['Automated reviewer failed to produce output'],
        };
    }

    if (review.confidenceScore < HUMAN_REVIEW_THRESHOLD && !review.requiresHumanReview) {
        review.requiresHumanReview = true;
        review.humanReviewReasons.push(
            `Confidence score (${review.confidenceScore}) is below the ${HUMAN_REVIEW_THRESHOLD} threshold`
        );
    }

    return {
        review,
        tokensUsed: result.tokensUsed,
        rawResponse: result.content,
    };
}

function validateReview(raw: any): ReviewResult {
    return {
        recommendationSupported: typeof raw.recommendationSupported === 'boolean' ? raw.recommendationSupported : false,
        confidenceScore: typeof raw.confidenceScore === 'number'
            ? Math.max(0, Math.min(100, raw.confidenceScore))
            : 50,
        challenges: Array.isArray(raw.challenges)
            ? raw.challenges.map((c: any) => ({
                area: c.area || '',
                challenge: c.challenge || '',
                severity: ['critical', 'significant', 'minor'].includes(c.severity) ? c.severity : 'significant',
                evidenceGap: c.evidenceGap || '',
            }))
            : [],
        devilsAdvocateCase: raw.devilsAdvocateCase || '',
        missingDiligence: Array.isArray(raw.missingDiligence) ? raw.missingDiligence : [],
        overallAssessment: raw.overallAssessment || '',
        requiresHumanReview: typeof raw.requiresHumanReview === 'boolean' ? raw.requiresHumanReview : true,
        humanReviewReasons: Array.isArray(raw.humanReviewReasons) ? raw.humanReviewReasons : [],
    };
}
