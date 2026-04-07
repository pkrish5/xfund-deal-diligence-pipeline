import type {
    AgentStrategy,
    StrategyParams,
    StrategyResult,
    DomainAgentOutput,
} from '../types.js';
import { parseJsonFromLLM, validateDomainOutput } from '../types.js';
import { STRUCTURED_OUTPUT_INSTRUCTIONS, CRITIQUE_INSTRUCTIONS } from '../prompts/structured-output.js';

/**
 * Two-Turn Self-Critique Strategy
 *
 * Turn 1: Generate structured analysis from raw research
 * Turn 2: Self-critique and produce a revised final output
 *
 * Total: 2 LLM calls per domain agent (Phase 2 only; Phase 1 Perplexity search is separate)
 */
export class TwoTurnStrategy implements AgentStrategy {
    name = 'two-turn' as const;

    async execute(params: StrategyParams): Promise<StrategyResult> {
        const { client, agentKey, domainPrompt, rawResearch, citations, companyName, founderName, additionalContext, signal } = params;
        let totalTokens = 0;

        // ── Turn 1: Initial structured analysis ──
        const turn1System = `${domainPrompt}\n\n${STRUCTURED_OUTPUT_INSTRUCTIONS}`;
        const turn1User = this.buildResearchContext(rawResearch, citations, companyName, founderName, additionalContext);

        const turn1Result = await client.complete({
            systemPrompt: turn1System,
            messages: [{ role: 'user', content: turn1User }],
            temperature: 0.3,
            maxTokens: 4096,
            jsonMode: true,
            signal,
        });
        totalTokens += turn1Result.tokensUsed;

        let initialOutput: DomainAgentOutput;
        try {
            const parsed = parseJsonFromLLM<any>(turn1Result.content);
            initialOutput = validateDomainOutput(parsed, agentKey);
        } catch {
            initialOutput = validateDomainOutput({}, agentKey);
            initialOutput.summary = turn1Result.content.slice(0, 500);
            initialOutput.gaps.push('Failed to produce structured output on first attempt');
        }

        // ── Turn 2: Self-critique + revision in one step ──
        const turn2System = `${domainPrompt}

You previously produced a structured analysis. Now review it critically and produce an improved version.

${CRITIQUE_INSTRUCTIONS}

After your critique, produce a REVISED JSON output that addresses all issues you identified.
Respond with ONLY the revised JSON (same schema). No explanation outside the JSON.

${STRUCTURED_OUTPUT_INSTRUCTIONS}`;

        const turn2User = `Original research:\n${rawResearch}\n\nYour previous analysis:\n${JSON.stringify(initialOutput, null, 2)}\n\nReview this analysis for unsupported claims, optimism bias, logical gaps, and missing evidence. Then produce a revised, improved JSON output.`;

        const turn2Result = await client.complete({
            systemPrompt: turn2System,
            messages: [{ role: 'user', content: turn2User }],
            temperature: 0.3,
            maxTokens: 4096,
            jsonMode: true,
            signal,
        });
        totalTokens += turn2Result.tokensUsed;

        let finalOutput: DomainAgentOutput;
        try {
            const parsed = parseJsonFromLLM<any>(turn2Result.content);
            finalOutput = validateDomainOutput(parsed, agentKey);
        } catch {
            finalOutput = initialOutput;
        }

        finalOutput.rawCitations = citations;
        finalOutput.metadata = {
            model: client.getModelName(),
            strategy: this.name,
            turnsUsed: 2,
            searchPhaseTokens: 0,
            synthesisPhaseTokens: totalTokens,
        };

        return {
            output: finalOutput,
            turnsUsed: 2,
            totalTokens,
        };
    }

    private buildResearchContext(
        rawResearch: string,
        citations: Array<{ title: string; url: string }>,
        companyName: string,
        founderName: string,
        additionalContext: string
    ): string {
        let context = `Company: ${companyName}\nFounder(s): ${founderName}\n\n`;
        context += `=== RAW RESEARCH (from web search) ===\n${rawResearch}\n\n`;

        if (citations.length > 0) {
            context += `=== SOURCES ===\n`;
            for (const c of citations) {
                context += `- ${c.title}: ${c.url}\n`;
            }
            context += '\n';
        }

        if (additionalContext) {
            context += `=== ADDITIONAL CONTEXT (meeting notes) ===\n${additionalContext}\n`;
        }

        context += `\nAnalyze this research and produce a structured JSON analysis following the schema in your instructions.`;
        return context;
    }
}
