import type {
    SynthesisLLMInterface,
    DomainAgentOutput,
    VerificationResult,
    ScorecardResult,
    SynthesizedMemo,
    MemoSection,
} from './types.js';
import { parseJsonFromLLM } from './types.js';
import {
    SCORECARD_SYSTEM_PROMPT,
    MEMO_SYSTEM_PROMPT,
    buildScorecardUserMessage,
    buildMemoUserMessage,
} from './prompts/synthesis.js';

export interface SynthesisInput {
    agentOutputs: Array<{ agentKey: string; output: DomainAgentOutput }>;
    verification: VerificationResult;
    meetingNotes: string;
    companyName: string;
    founderName: string;
    signal?: AbortSignal;
}

export interface ScorecardResponse {
    scorecard: ScorecardResult;
    tokensUsed: number;
    rawResponse: string;
}

export interface MemoResponse {
    memo: SynthesizedMemo;
    rawMarkdown: string;
    tokensUsed: number;
}

export interface SynthesisResponse {
    scorecard: ScorecardResult;
    memo: SynthesizedMemo;
    rawMemoMarkdown: string;
    totalTokens: number;
}

/**
 * Synthesis Agent — Two sequential calls:
 *
 * Call 1: Scorecard (structured JSON) from all domain outputs + verification
 * Call 2: IC Memo (narrative markdown) using scorecard + domain outputs + verification + notes
 */
export async function runSynthesis(
    client: SynthesisLLMInterface,
    input: SynthesisInput
): Promise<SynthesisResponse> {
    const { signal } = input;

    // ── Call 1: Scorecard ──
    const scorecardResult = await generateScorecard(client, input);

    // ── Call 2: Memo (uses scorecard as input) ──
    const memoResult = await generateMemo(client, input, scorecardResult.scorecard);

    return {
        scorecard: scorecardResult.scorecard,
        memo: memoResult.memo,
        rawMemoMarkdown: memoResult.rawMarkdown,
        totalTokens: scorecardResult.tokensUsed + memoResult.tokensUsed,
    };
}

export async function generateScorecard(
    client: SynthesisLLMInterface,
    input: SynthesisInput
): Promise<ScorecardResponse> {
    const { agentOutputs, verification, companyName, founderName, signal } = input;

    const userMessage = buildScorecardUserMessage(agentOutputs, verification, companyName, founderName);

    const result = await client.complete({
        systemPrompt: SCORECARD_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0.3,
        maxTokens: 4096,
        jsonMode: true,
        signal,
    });

    let scorecard: ScorecardResult;
    try {
        const parsed = parseJsonFromLLM<any>(result.content);
        scorecard = validateScorecard(parsed);
    } catch {
        scorecard = {
            overallScore: 'C',
            overallRecommendation: 'MORE_INFO',
            domainScores: [],
            strengthsSummary: ['Scorecard generation failed — manual review needed'],
            weaknessesSummary: ['Automated scoring could not be completed'],
            criticalQuestions: ['Review all domain agent outputs manually'],
        };
    }

    return {
        scorecard,
        tokensUsed: result.tokensUsed,
        rawResponse: result.content,
    };
}

export async function generateMemo(
    client: SynthesisLLMInterface,
    input: SynthesisInput,
    scorecard: ScorecardResult
): Promise<MemoResponse> {
    const { agentOutputs, verification, meetingNotes, companyName, founderName, signal } = input;

    const userMessage = buildMemoUserMessage(
        scorecard, agentOutputs, verification, meetingNotes, companyName, founderName
    );

    const result = await client.complete({
        systemPrompt: MEMO_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0.4,
        maxTokens: 6000,
        signal,
    });

    const rawMarkdown = result.content;
    const memo = parseMemoFromMarkdown(rawMarkdown, companyName);

    return {
        memo,
        rawMarkdown,
        tokensUsed: result.tokensUsed,
    };
}

function parseMemoFromMarkdown(markdown: string, companyName: string): SynthesizedMemo {
    const sections: MemoSection[] = [];
    const sectionRegex = /^##?\s+(.+)$/gm;
    let lastIndex = 0;
    let lastHeading = 'Introduction';
    let match;

    while ((match = sectionRegex.exec(markdown)) !== null) {
        if (lastIndex > 0) {
            sections.push({
                heading: lastHeading,
                content: markdown.slice(lastIndex, match.index).trim(),
            });
        }
        lastHeading = match[1];
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex > 0) {
        sections.push({
            heading: lastHeading,
            content: markdown.slice(lastIndex).trim(),
        });
    } else {
        sections.push({
            heading: 'IC Memo',
            content: markdown.trim(),
        });
    }

    return {
        title: `IC Memo — ${companyName}`,
        sections,
    };
}

function validateScorecard(raw: any): ScorecardResult {
    return {
        overallScore: (['A', 'B', 'C', 'D'].includes(raw.overallScore) ? raw.overallScore : 'C') as any,
        overallRecommendation:
            ['STRONG_PROCEED', 'PROCEED', 'MORE_INFO', 'LEAN_PASS', 'PASS'].includes(raw.overallRecommendation)
                ? raw.overallRecommendation
                : 'MORE_INFO',
        domainScores: Array.isArray(raw.domainScores)
            ? raw.domainScores.map((d: any) => ({
                domain: d.domain || '',
                score: d.score || 'C',
                adjustedScore: d.adjustedScore || d.score || 'C',
                weight: typeof d.weight === 'number' ? d.weight : 0.1,
                keyFinding: d.keyFinding || '',
            }))
            : [],
        strengthsSummary: Array.isArray(raw.strengthsSummary) ? raw.strengthsSummary : [],
        weaknessesSummary: Array.isArray(raw.weaknessesSummary) ? raw.weaknessesSummary : [],
        criticalQuestions: Array.isArray(raw.criticalQuestions) ? raw.criticalQuestions : [],
    };
}
