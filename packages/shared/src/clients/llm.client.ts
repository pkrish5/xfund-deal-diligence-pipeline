export interface LLMConfig {
    apiKey: string;
    model?: string;
    baseURL?: string;
}

export interface ResearchResult {
    summary: string;
    citations: Array<{
        title: string;
        url?: string;
        quote?: string;
        confidence: number;
    }>;
    confidenceScore: number;
}

export interface MemoResult {
    title: string;
    sections: Array<{
        heading: string;
        content: string;
    }>;
}

const BASE_ANALYST_PROMPT = `You are an investment analyst at a venture capital firm conducting due diligence.
Instructions:
- Write in concise bullet points under each section.
- Always quantify metrics or statements when possible (e.g., market size, growth rates, valuation multiples).
- After each point, cite your source in parentheses — e.g., "(company website)" or "(TechCrunch, Jan 2026)."
- If external information is used, include the hyperlinked source in markdown format.
- If you find limited or no data for a section, explicitly note that ("Limited public data found on X").
- Where data is incomplete, clearly state reasonable assumptions and briefly explain your reasoning.
- Keep the tone professional and neutral, as if writing for an investment committee memo.
- Synthesize insights — do not copy text verbatim from sources.
- Format output in markdown: use ### for sub-section headings, - for bullet points, and **bold** for emphasis.
- Do NOT use #### headings — use ### as the smallest heading level.
- Do NOT use ## headings — those are reserved for the top-level section title which is added automatically.
- Do NOT use markdown tables (| column | format). Instead, present comparative data as bullet points or numbered lists.
- Each section should include: core findings (2–5 bullet points), quantitative metrics where available, key risks or questions for further diligence.
- Goal: Deliver a decision-oriented, insight-rich diligence analysis to support an investment recommendation.

CRITICAL — Company Identity Verification:
- You MUST verify that any information you find actually refers to the EXACT company being researched, using the founder name(s) and meeting notes as ground truth.
- Many companies share similar names. If you find a company with the same name but different founders, location, or industry, DO NOT use that information. Instead, note: "⚠️ A different company named [X] exists ([description]) — this is NOT the company under diligence."
- Cross-reference founder names, industry, and any meeting notes context to confirm you have the right entity.
- If you cannot find reliable public information about the specific company, say "Limited public data found" rather than guessing or using data from a different company.
- NEVER fabricate URLs, funding amounts, metrics, or quotes. Only cite information you actually found.`;



const RESEARCH_PROMPTS: Record<string, string> = {
    founders_team: `${BASE_ANALYST_PROMPT}

Section: FOUNDERS & TEAM ANALYSIS
Research the founder(s) and core team. Provide:
1. Founder backgrounds (education, prior roles, domain expertise)
2. Previous startups, exits, or notable achievements
3. Team composition and key hires
4. Founder-market fit assessment (why are THEY the right team for THIS problem?)
5. Any red flags (gaps in experience, high turnover, etc.)
Grade the team on a scale: A/B/C/D with brief justification.`,

    market_opportunity: `${BASE_ANALYST_PROMPT}

Section: MARKET & OPPORTUNITY
Analyze the market opportunity. Provide:
1. Market size estimates (TAM/SAM/SOM) with sources
2. Growth rate, CAGR, and key market drivers
3. Timing — why is this the right moment for this company?
4. Macro tailwinds and headwinds affecting the space
5. Comparable valuations and recent financings in the sector
Grade the market on a scale: A/B/C/D with brief justification.`,

    competition: `${BASE_ANALYST_PROMPT}

Section: COMPETITION
Analyze the competitive landscape. Provide:
1. Direct competitors — names, funding, stage, key metrics
2. Indirect competitors and potential entrants
3. Competitive advantages and disadvantages vs. each
4. Positioning map (where does this company sit?)
5. Risk of incumbents entering or acqui-hiring
Grade competition risk on a scale: A/B/C/D with brief justification.`,

    business_model: `${BASE_ANALYST_PROMPT}

Section: BUSINESS MODEL
Analyze the business model. Provide:
1. Revenue model (SaaS, marketplace, usage-based, etc.)
2. Pricing strategy and unit economics (ACV, LTV, CAC if available)
3. Gross margin profile and scalability
4. Path to profitability or breakeven
5. Revenue concentration risks
Grade the business model on a scale: A/B/C/D with brief justification.`,

    traction: `${BASE_ANALYST_PROMPT}

Section: TRACTION
Analyze traction signals. Provide:
1. Revenue or ARR (current and growth trajectory)
2. User/customer counts and growth rates
3. Key partnerships or signed contracts
4. Product milestones and launches
5. Press coverage and media mentions
6. App store rankings, social media presence, community
If no public data exists, note that explicitly with suggested questions for founders.
Grade traction on a scale: A/B/C/D with brief justification.`,

    defensibility: `${BASE_ANALYST_PROMPT}

Section: DEFENSIBILITY
Analyze the product's defensibility and moat. Provide:
1. Technical moat (proprietary tech, patents, IP)
2. Network effects (direct, indirect, data)
3. Switching costs and lock-in mechanisms
4. Brand or trust advantages
5. Data advantages and compounding effects
6. How replicable is this by a well-funded competitor?
Grade defensibility on a scale: A/B/C/D with brief justification.`,

    risks: `${BASE_ANALYST_PROMPT}

Section: RISKS
Identify and categorize all material risks. Provide:
1. Market risks (timing, adoption, demand)
2. Execution risks (team, hiring, scaling)
3. Technology risks (feasibility, reliability)
4. Competitive risks (displacement, commoditization)
5. Regulatory/legal risks
6. Financial risks (burn rate, funding dependency)
7. Strategic risks (brand confusion, key-person dependency)
Rate each risk as Low/Medium/High with brief justification.`,

    questions: `${BASE_ANALYST_PROMPT}

Section: QUESTIONS FOR FOUNDERS
Based on your research, generate the most important diligence questions organized by category:
1. Competition — what questions should we ask about competitive positioning?
2. Traction — what metrics and proof points should we request?
3. Business Model — what questions about unit economics, pricing, and revenue?
4. Team — what questions about hiring plans, org structure, and gaps?
5. Defensibility — what questions about moat, IP, and data rights?
Format as clear, specific questions that would surface decision-relevant information.`,

    conditions: `${BASE_ANALYST_PROMPT}

Section: CONDITIONS FOR INVESTMENT
Based on all available information, provide:
1. Bull Case (Path to Success) — 2-3 scenarios where this becomes a great investment
2. Bear Case (Failure Modes) — 2-3 scenarios where this fails
3. Required Answers Before Committing — what must be verified before investing?
4. If Investing (Indicative Stance) — under what conditions would you proceed?
5. Overall recommendation: Proceed / Pass / More Info Needed with 3-5 bullet justification
Be specific and evidence-based in each scenario.`,
};

export class LLMClient {
    private config: LLMConfig;
    private clientPromise: Promise<any> | null = null;

    constructor(config: LLMConfig) {
        this.config = config;
    }

    private async getClient(): Promise<any> {
        if (!this.clientPromise) {
            this.clientPromise = import('openai').then(
                (mod) => new mod.default({
                    apiKey: this.config.apiKey,
                    baseURL: this.config.baseURL || 'https://api.perplexity.ai',
                })
            );
        }
        return this.clientPromise;
    }

    /**
     * Run a research agent using Perplexity's Chat Completions API with built-in web search.
     * Perplexity automatically searches the web and cites sources.
     */
    async runResearch(
        agentKey: string,
        companyName: string,
        founderName: string,
        additionalContext: string = '',
        signal?: AbortSignal
    ): Promise<ResearchResult> {
        const systemPrompt = RESEARCH_PROMPTS[agentKey];
        if (!systemPrompt) {
            throw new Error(`Unknown research agent key: ${agentKey}`);
        }

        const userPrompt = `Company: ${companyName}\nFounder(s): ${founderName}\n${additionalContext ? `\nPrimary Source Material (Meeting Notes):\n${additionalContext}\n(Prioritize these notes alongside web search results)` : ''}`;

        const client = await this.getClient();

        const response = await client.chat.completions.create(
            {
                model: this.config.model || 'sonar-pro',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.3,
                web_search_options: { search_context_size: 'high' },
            },
            { signal }
        );

        const content = response.choices[0]?.message?.content || '';
        const citations: ResearchResult['citations'] = [];

        // Extract citations from Perplexity's response
        if (response.citations && Array.isArray(response.citations)) {
            for (const url of response.citations) {
                citations.push({
                    title: url,
                    url: url,
                    confidence: 0.85,
                });
            }
        }

        return {
            summary: content,
            citations,
            confidenceScore: 0.85,
        };
    }

    /**
     * Generate an IC memo from research results and meeting notes.
     * Uses standard Chat Completions API (no web search needed for synthesis).
     */
    async generateMemo(
        companyName: string,
        founderName: string,
        researchSections: Record<string, string>,
        meetingNotes: string = '',
        signal?: AbortSignal
    ): Promise<MemoResult> {
        const researchContext = Object.entries(researchSections)
            .map(([key, content]) => `## ${key}\n${content}`)
            .join('\n\n');

        const client = await this.getClient();
        const response = await client.chat.completions.create(
            {
                model: this.config.model || 'sonar-pro',
                messages: [
                    {
                        role: 'system',
                        content: `${BASE_ANALYST_PROMPT}

Prepare an Investment Committee (IC) memo. 

Structure the memo with these sections:
1. Executive Summary (2-3 sentences)
2. Company Overview
3. Market Opportunity
4. Competitive Landscape
5. Team Assessment
6. Product & Defensibility
7. Traction & Metrics
8. Key Risks
9. Investment Thesis
10. Recommendation (Proceed / Pass / More Info Needed)
   - 3–5 bullet justification
   - Top follow-up diligence questions

Materials to Use (in priority order):
1. Meeting Notes (provided by user)
2. Research Results (provided by user)
3. General Knowledge`,
                    },
                    {
                        role: 'user',
                        content: `Company: ${companyName}\nFounder(s): ${founderName}\n\n${meetingNotes ? `Meeting Notes (High Priority):\n${meetingNotes}\n\n` : ''}Research Results:\n${researchContext}`,
                    },
                ],
                temperature: 0.4,
                max_tokens: 4000,
            },
            { signal }
        );

        const content = response.choices[0]?.message?.content || '';

        // Parse sections from the memo
        const sections: MemoResult['sections'] = [];
        const sectionRegex = /^##?\s+(.+)$/gm;
        let lastIndex = 0;
        let lastHeading = 'Introduction';
        let match;

        while ((match = sectionRegex.exec(content)) !== null) {
            if (lastIndex > 0) {
                sections.push({
                    heading: lastHeading,
                    content: content.slice(lastIndex, match.index).trim(),
                });
            }
            lastHeading = match[1];
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex > 0) {
            sections.push({
                heading: lastHeading,
                content: content.slice(lastIndex).trim(),
            });
        } else {
            sections.push({
                heading: 'IC Memo',
                content: content.trim(),
            });
        }

        return {
            title: `IC Memo — ${companyName}`,
            sections,
        };
    }
}
