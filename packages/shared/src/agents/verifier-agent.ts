import type { SynthesisLLMInterface, DomainAgentOutput, VerificationResult } from './types.js';
import { parseJsonFromLLM } from './types.js';
import { VERIFIER_SYSTEM_PROMPT, buildVerifierUserMessage } from './prompts/verifier.js';

export interface VerifierInput {
    agentOutputs: Array<{ agentKey: string; output: DomainAgentOutput }>;
    companyName: string;
    founderName: string;
    signal?: AbortSignal;
}

export interface VerifierResult {
    verification: VerificationResult;
    tokensUsed: number;
    rawResponse: string;
}

/**
 * Verifier / Critic Agent
 *
 * Cross-checks all 9 domain agent outputs for contradictions,
 * unsupported claims, score calibration issues, and evidence gaps.
 * Annotates only — does not modify original outputs.
 */
export async function runVerifier(
    client: SynthesisLLMInterface,
    input: VerifierInput
): Promise<VerifierResult> {
    const { agentOutputs, companyName, founderName, signal } = input;

    const userMessage = buildVerifierUserMessage(agentOutputs, companyName, founderName);

    const result = await client.complete({
        systemPrompt: VERIFIER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0.3,
        maxTokens: 4096,
        jsonMode: true,
        signal,
    });

    let verification: VerificationResult;
    try {
        const parsed = parseJsonFromLLM<any>(result.content);
        verification = validateVerification(parsed);
    } catch {
        verification = {
            contradictions: [],
            unsupportedClaims: [],
            scoreAdjustments: [],
            gaps: ['Verification parsing failed — manual review recommended'],
            overallEvidenceQuality: 'weak',
            humanReviewFlags: ['Automated verification could not be completed'],
            summary: 'Verification failed to produce structured output. Please review domain agent outputs manually.',
        };
    }

    return {
        verification,
        tokensUsed: result.tokensUsed,
        rawResponse: result.content,
    };
}

function validateVerification(raw: any): VerificationResult {
    return {
        contradictions: Array.isArray(raw.contradictions)
            ? raw.contradictions.map((c: any) => ({
                agentA: c.agentA || '',
                claimA: c.claimA || '',
                agentB: c.agentB || '',
                claimB: c.claimB || '',
                severity: ['high', 'medium', 'low'].includes(c.severity) ? c.severity : 'medium',
                resolution: c.resolution || undefined,
            }))
            : [],
        unsupportedClaims: Array.isArray(raw.unsupportedClaims)
            ? raw.unsupportedClaims.map((u: any) => ({
                agent: u.agent || '',
                claim: u.claim || '',
                reason: u.reason || '',
            }))
            : [],
        scoreAdjustments: Array.isArray(raw.scoreAdjustments)
            ? raw.scoreAdjustments.map((a: any) => ({
                agent: a.agent || '',
                originalScore: a.originalScore || 'C',
                adjustedScore: a.adjustedScore || 'C',
                reason: a.reason || '',
            }))
            : [],
        gaps: Array.isArray(raw.gaps) ? raw.gaps : [],
        overallEvidenceQuality:
            ['strong', 'moderate', 'weak'].includes(raw.overallEvidenceQuality)
                ? raw.overallEvidenceQuality
                : 'moderate',
        humanReviewFlags: Array.isArray(raw.humanReviewFlags) ? raw.humanReviewFlags : [],
        summary: raw.summary || '',
    };
}
