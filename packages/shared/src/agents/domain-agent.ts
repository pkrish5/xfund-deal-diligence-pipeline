import type { AgentKey, DomainAgentOutput, SynthesisLLMInterface, StrategyName } from './types.js';
import { LLMClient, type LLMConfig } from '../clients/llm.client.js';
import { getStrategy } from './strategies/index.js';
import { DOMAIN_ANALYSIS_PROMPTS } from './prompts/research.js';

export interface DomainAgentConfig {
    perplexityApiKey: string;
    synthesisClient: SynthesisLLMInterface;
    strategyOverride?: StrategyName;
    perplexityModel?: string;
}

export interface DomainAgentInput {
    agentKey: AgentKey;
    companyName: string;
    founderName: string;
    additionalContext?: string;
    signal?: AbortSignal;
}

export interface DomainAgentResult {
    output: DomainAgentOutput;
    rawSearchResponse: string;
    totalTokens: number;
}

/**
 * Two-Phase Domain Agent
 *
 * Phase 1 (Search): Perplexity sonar-pro with web search → raw markdown + citations
 * Phase 2 (Structure): Anthropic/OpenAI with strategy (two-turn or multi-turn reflection) → DomainAgentOutput
 */
export async function runDomainAgent(
    config: DomainAgentConfig,
    input: DomainAgentInput
): Promise<DomainAgentResult> {
    const { perplexityApiKey, synthesisClient, strategyOverride, perplexityModel } = config;
    const { agentKey, companyName, founderName, additionalContext, signal } = input;

    // ── Phase 1: Perplexity Web Search ──
    const perplexity = new LLMClient({
        apiKey: perplexityApiKey,
        model: perplexityModel,
    });

    const searchResult = await perplexity.runResearch(
        agentKey,
        companyName,
        founderName,
        additionalContext || '',
        signal
    );

    const searchTokens = 0; // Perplexity doesn't report tokens in the same way

    // ── Phase 2: Structured Analysis via Strategy ──
    const domainPrompt = DOMAIN_ANALYSIS_PROMPTS[agentKey];
    if (!domainPrompt) {
        throw new Error(`No domain analysis prompt for agent key: ${agentKey}`);
    }

    const strategy = getStrategy(strategyOverride);

    const citations = searchResult.citations.map(c => ({
        title: c.title,
        url: c.url || '',
    }));

    const strategyResult = await strategy.execute({
        client: synthesisClient,
        agentKey,
        domainPrompt,
        rawResearch: searchResult.summary,
        citations,
        companyName,
        founderName,
        additionalContext: additionalContext || '',
        signal,
    });

    strategyResult.output.metadata.searchPhaseTokens = searchTokens;

    return {
        output: strategyResult.output,
        rawSearchResponse: searchResult.summary,
        totalTokens: searchTokens + strategyResult.totalTokens,
    };
}
