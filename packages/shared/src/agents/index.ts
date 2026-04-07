// Agent types
export type {
    AgentKey,
    DiligencePhase,
    StrategyName,
    Score,
    Confidence,
    Recommendation,
    Finding,
    DomainAgentOutput,
    Contradiction,
    UnsupportedClaim,
    ScoreAdjustment,
    VerificationResult,
    DomainScore,
    ScorecardResult,
    MemoSection,
    SynthesizedMemo,
    Challenge,
    ReviewResult,
    AgentStrategy,
    StrategyParams,
    StrategyResult,
    SynthesisProvider,
    SynthesisLLMConfig,
    SynthesisLLMInterface,
    CompletionParams,
    CompletionResult,
} from './types.js';

export {
    parseJsonFromLLM,
    validateDomainOutput,
    isDomainOutputAcceptable,
    AGENT_DISPLAY_TITLES,
    RESEARCH_ORDER,
} from './types.js';

// Domain agent
export { runDomainAgent, type DomainAgentConfig, type DomainAgentInput, type DomainAgentResult } from './domain-agent.js';

// Verifier
export { runVerifier, type VerifierInput, type VerifierResult } from './verifier-agent.js';

// Synthesis
export { runSynthesis, generateScorecard, generateMemo, type SynthesisInput, type SynthesisResponse } from './synthesis-agent.js';

// Reviewer
export { runReviewer, type ReviewerInput, type ReviewerResponse } from './reviewer-agent.js';

// Strategies
export { getStrategy, TwoTurnStrategy, MultiTurnReflectionStrategy } from './strategies/index.js';
