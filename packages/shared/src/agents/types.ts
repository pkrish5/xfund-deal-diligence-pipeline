// ─── Core Types for Multi-Agent Diligence Pipeline ───

export type AgentKey =
    | 'founders_team'
    | 'market_opportunity'
    | 'competition'
    | 'business_model'
    | 'traction'
    | 'defensibility'
    | 'risks'
    | 'questions'
    | 'conditions';

export type DiligencePhase = 'research' | 'verification' | 'scorecard' | 'memo' | 'review';

export type StrategyName = 'two-turn' | 'multi-turn-reflection';

export type Score = 'A' | 'B' | 'C' | 'D';

export type Confidence = 'high' | 'medium' | 'low';

export type Recommendation = 'STRONG_PROCEED' | 'PROCEED' | 'MORE_INFO' | 'LEAN_PASS' | 'PASS';

// ─── Domain Agent Output ───

export interface Finding {
    claim: string;
    evidence: string;
    sourceUrl?: string;
    confidence: Confidence;
}

export interface DomainAgentOutput {
    agentKey: AgentKey;
    summary: string;
    findings: Finding[];
    provisionalScore: Score;
    scoreJustification: string;
    assumptions: string[];
    gaps: string[];
    risksIdentified: string[];
    rawCitations: Array<{ title: string; url: string }>;
    metadata: {
        model: string;
        strategy: StrategyName;
        turnsUsed: number;
        searchPhaseTokens: number;
        synthesisPhaseTokens: number;
    };
}

// ─── Verification Output ───

export interface Contradiction {
    agentA: string;
    claimA: string;
    agentB: string;
    claimB: string;
    severity: 'high' | 'medium' | 'low';
    resolution?: string;
}

export interface UnsupportedClaim {
    agent: string;
    claim: string;
    reason: string;
}

export interface ScoreAdjustment {
    agent: string;
    originalScore: Score;
    adjustedScore: Score;
    reason: string;
}

export interface VerificationResult {
    contradictions: Contradiction[];
    unsupportedClaims: UnsupportedClaim[];
    scoreAdjustments: ScoreAdjustment[];
    gaps: string[];
    overallEvidenceQuality: 'strong' | 'moderate' | 'weak';
    humanReviewFlags: string[];
    summary: string;
}

// ─── Scorecard Output ───

export interface DomainScore {
    domain: string;
    score: Score;
    adjustedScore?: Score;
    weight: number;
    keyFinding: string;
}

export interface ScorecardResult {
    overallScore: Score;
    overallRecommendation: Recommendation;
    domainScores: DomainScore[];
    strengthsSummary: string[];
    weaknessesSummary: string[];
    criticalQuestions: string[];
}

// ─── Memo Output ───

export interface MemoSection {
    heading: string;
    content: string;
}

export interface SynthesizedMemo {
    title: string;
    sections: MemoSection[];
}

// ─── Reviewer Output ───

export interface Challenge {
    area: string;
    challenge: string;
    severity: 'critical' | 'significant' | 'minor';
    evidenceGap: string;
}

export interface ReviewResult {
    recommendationSupported: boolean;
    confidenceScore: number;
    challenges: Challenge[];
    devilsAdvocateCase: string;
    missingDiligence: string[];
    overallAssessment: string;
    requiresHumanReview: boolean;
    humanReviewReasons: string[];
}

// ─── Strategy Interface ───

export interface StrategyParams {
    client: SynthesisLLMInterface;
    agentKey: AgentKey;
    domainPrompt: string;
    rawResearch: string;
    citations: Array<{ title: string; url: string }>;
    companyName: string;
    founderName: string;
    additionalContext: string;
    signal?: AbortSignal;
}

export interface StrategyResult {
    output: DomainAgentOutput;
    turnsUsed: number;
    totalTokens: number;
}

export interface AgentStrategy {
    name: StrategyName;
    execute(params: StrategyParams): Promise<StrategyResult>;
}

// ─── Synthesis LLM Interface (Anthropic / OpenAI) ───

export type SynthesisProvider = 'anthropic' | 'openai';

export interface SynthesisLLMConfig {
    provider: SynthesisProvider;
    apiKey: string;
    model?: string;
}

export interface CompletionParams {
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    signal?: AbortSignal;
}

export interface CompletionResult {
    content: string;
    tokensUsed: number;
}

export interface SynthesisLLMInterface {
    complete(params: CompletionParams): Promise<CompletionResult>;
    getModelName(): string;
}

// ─── JSON Parsing Utilities ───

export function parseJsonFromLLM<T>(raw: string): T {
    let cleaned = raw.trim();

    // Strip markdown code fences
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
    }

    // Try direct parse
    try {
        return JSON.parse(cleaned);
    } catch {
        // Try extracting first JSON object
        const objMatch = cleaned.match(/\{[\s\S]*\}/);
        if (objMatch) {
            return JSON.parse(objMatch[0]);
        }
        throw new Error(`Failed to parse JSON from LLM response: ${cleaned.slice(0, 200)}...`);
    }
}

export function validateDomainOutput(raw: any, agentKey: AgentKey): DomainAgentOutput {
    return {
        agentKey,
        summary: raw.summary || '',
        findings: Array.isArray(raw.findings)
            ? raw.findings.map((f: any) => ({
                claim: f.claim || '',
                evidence: f.evidence || '',
                sourceUrl: f.sourceUrl || undefined,
                confidence: (['high', 'medium', 'low'].includes(f.confidence) ? f.confidence : 'low') as Confidence,
            }))
            : [],
        provisionalScore: (['A', 'B', 'C', 'D'].includes(raw.provisionalScore) ? raw.provisionalScore : 'C') as Score,
        scoreJustification: raw.scoreJustification || '',
        assumptions: Array.isArray(raw.assumptions) ? raw.assumptions : [],
        gaps: Array.isArray(raw.gaps) ? raw.gaps : [],
        risksIdentified: Array.isArray(raw.risksIdentified) ? raw.risksIdentified : [],
        rawCitations: [],
        metadata: { model: '', strategy: 'multi-turn-reflection', turnsUsed: 0, searchPhaseTokens: 0, synthesisPhaseTokens: 0 },
    };
}

export function isDomainOutputAcceptable(output: DomainAgentOutput): boolean {
    if (output.findings.length < 2) return false;
    if (!output.scoreJustification || output.scoreJustification.length < 20) return false;
    if (!output.summary || output.summary.length < 80) return false;
    const hasEvidence = output.findings.every(f => f.evidence && f.evidence.length > 10);
    if (!hasEvidence) return false;
    return true;
}

export const AGENT_DISPLAY_TITLES: Record<AgentKey, string> = {
    founders_team: '1. Founders & Team Analysis',
    market_opportunity: '2. Market & Opportunity',
    competition: '3. Competition',
    business_model: '4. Business Model',
    traction: '5. Traction',
    defensibility: '6. Defensibility',
    risks: '7. Risks',
    questions: '8. Questions for Founders',
    conditions: '9. Conditions for Investment',
};

export const RESEARCH_ORDER: AgentKey[] = [
    'founders_team',
    'market_opportunity',
    'competition',
    'business_model',
    'traction',
    'defensibility',
    'risks',
    'questions',
    'conditions',
];
