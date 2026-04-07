import type {
    AgentStrategy,
    StrategyParams,
    StrategyResult,
    DomainAgentOutput,
} from '../types.js';
import { parseJsonFromLLM, validateDomainOutput, isDomainOutputAcceptable } from '../types.js';
import {
    STRUCTURED_OUTPUT_INSTRUCTIONS,
    CRITIQUE_INSTRUCTIONS,
    REVISION_INSTRUCTIONS,
} from '../prompts/structured-output.js';

const MAX_REFLECTION_CYCLES = 2;

/**
 * Multi-Turn Reflection Strategy
 *
 * Turn 1: Generate initial structured analysis
 * Turn 2: Independent critique (identifies weaknesses)
 * Turn 3: Revise based on critique
 * Turn 4+: If quality threshold not met, repeat critique → revise (up to MAX_REFLECTION_CYCLES)
 *
 * Total: 3-5 LLM calls per domain agent (Phase 2 only)
 */
export class MultiTurnReflectionStrategy implements AgentStrategy {
    name = 'multi-turn-reflection' as const;

    async execute(params: StrategyParams): Promise<StrategyResult> {
        const { client, agentKey, domainPrompt, rawResearch, citations, companyName, founderName, additionalContext, signal } = params;
        let totalTokens = 0;
        let turnsUsed = 0;

        const researchContext = this.buildResearchContext(rawResearch, citations, companyName, founderName, additionalContext);

        // ── Turn 1: Initial structured analysis ──
        const generateSystem = `${domainPrompt}\n\n${STRUCTURED_OUTPUT_INSTRUCTIONS}`;

        const turn1Result = await client.complete({
            systemPrompt: generateSystem,
            messages: [{ role: 'user', content: researchContext }],
            temperature: 0.3,
            maxTokens: 4096,
            jsonMode: true,
            signal,
        });
        totalTokens += turn1Result.tokensUsed;
        turnsUsed++;

        let currentOutput: DomainAgentOutput;
        try {
            const parsed = parseJsonFromLLM<any>(turn1Result.content);
            currentOutput = validateDomainOutput(parsed, agentKey);
        } catch {
            currentOutput = validateDomainOutput({}, agentKey);
            currentOutput.summary = turn1Result.content.slice(0, 500);
            currentOutput.gaps.push('Failed to produce structured output on first attempt');
        }

        // ── Reflection loop ──
        for (let cycle = 0; cycle < MAX_REFLECTION_CYCLES; cycle++) {
            if (isDomainOutputAcceptable(currentOutput) && cycle > 0) {
                break;
            }

            // ── Critique turn ──
            const critiqueResult = await client.complete({
                systemPrompt: CRITIQUE_INSTRUCTIONS,
                messages: [{
                    role: 'user',
                    content: this.buildCritiqueInput(currentOutput, rawResearch, agentKey),
                }],
                temperature: 0.4,
                maxTokens: 2048,
                signal,
            });
            totalTokens += critiqueResult.tokensUsed;
            turnsUsed++;

            const critique = critiqueResult.content;

            // ── Revision turn ──
            const revisionSystem = `${domainPrompt}\n\n${REVISION_INSTRUCTIONS}\n\n${STRUCTURED_OUTPUT_INSTRUCTIONS}`;

            const revisionResult = await client.complete({
                systemPrompt: revisionSystem,
                messages: [{
                    role: 'user',
                    content: this.buildRevisionInput(currentOutput, critique, rawResearch, additionalContext),
                }],
                temperature: 0.3,
                maxTokens: 4096,
                jsonMode: true,
                signal,
            });
            totalTokens += revisionResult.tokensUsed;
            turnsUsed++;

            try {
                const parsed = parseJsonFromLLM<any>(revisionResult.content);
                const revised = validateDomainOutput(parsed, agentKey);

                if (revised.findings.length >= currentOutput.findings.length) {
                    currentOutput = revised;
                }
            } catch {
                // Keep current output if revision parsing fails
            }
        }

        currentOutput.rawCitations = citations;
        currentOutput.metadata = {
            model: client.getModelName(),
            strategy: this.name,
            turnsUsed,
            searchPhaseTokens: 0,
            synthesisPhaseTokens: totalTokens,
        };

        return {
            output: currentOutput,
            turnsUsed,
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

    private buildCritiqueInput(output: DomainAgentOutput, rawResearch: string, agentKey: string): string {
        return `You are reviewing a "${agentKey}" analysis for a venture capital diligence process.

=== ANALYSIS TO REVIEW ===
Score: ${output.provisionalScore}
Justification: ${output.scoreJustification}

Summary:
${output.summary}

Findings:
${output.findings.map((f, i) => `${i + 1}. [${f.confidence}] ${f.claim}\n   Evidence: ${f.evidence}`).join('\n')}

Assumptions: ${output.assumptions.join('; ') || 'None listed'}
Gaps: ${output.gaps.join('; ') || 'None listed'}
Risks: ${output.risksIdentified.join('; ') || 'None listed'}

=== ORIGINAL RAW RESEARCH ===
${rawResearch.slice(0, 3000)}

Provide a thorough critique. Be specific about what needs to improve.`;
    }

    private buildRevisionInput(
        output: DomainAgentOutput,
        critique: string,
        rawResearch: string,
        additionalContext: string
    ): string {
        let input = `=== ORIGINAL RESEARCH ===\n${rawResearch}\n\n`;
        if (additionalContext) {
            input += `=== MEETING NOTES ===\n${additionalContext}\n\n`;
        }
        input += `=== PREVIOUS ANALYSIS ===\n${JSON.stringify(output, null, 2)}\n\n`;
        input += `=== CRITIQUE ===\n${critique}\n\n`;
        input += `Address ALL critique points. Produce a revised JSON analysis.`;
        return input;
    }
}
