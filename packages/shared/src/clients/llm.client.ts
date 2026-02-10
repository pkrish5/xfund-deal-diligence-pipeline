export interface LLMConfig {
    apiKey: string;
    model?: string;
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

const RESEARCH_PROMPTS: Record<string, string> = {
    market_tam: `You are a venture capital research analyst. Analyze the market opportunity and Total Addressable Market (TAM) for the following company. Provide:
1. Market size estimates with sources
2. Growth rate and trends
3. Key market drivers
4. TAM/SAM/SOM breakdown if possible

Be specific with numbers and cite sources where possible.`,

    competitors: `You are a venture capital research analyst. Analyze the competitive landscape for the following company. Provide:
1. Direct competitors and their funding/stage
2. Indirect competitors
3. Competitive advantages/disadvantages
4. Market positioning map

Be specific and cite sources where possible.`,

    founder_background: `You are a venture capital research analyst. Research the founder(s) background for the following company. Provide:
1. Educational background
2. Previous work experience
3. Previous startups or exits
4. Domain expertise relevance
5. Notable achievements or connections

Be specific and cite sources where possible.`,

    risks_redflags: `You are a venture capital research analyst. Identify potential risks and red flags for the following company. Provide:
1. Market risks
2. Execution risks
3. Regulatory risks
4. Technology risks
5. Team risks
6. Financial/business model risks

Be balanced but thorough. Rate each risk as Low/Medium/High.`,

    product_defensibility: `You are a venture capital research analyst. Analyze the product and defensibility for the following company. Provide:
1. Product description and value proposition
2. Technical moat (if any)
3. Network effects
4. Switching costs
5. IP/patents
6. Data advantages

Be specific about what creates lasting competitive advantage.`,

    traction_signals: `You are a venture capital research analyst. Analyze traction signals for the following company. Look for:
1. Revenue or growth metrics (if publicly available)
2. User/customer counts
3. Press coverage and media mentions
4. App store rankings
5. Social media presence
6. Job postings (indicator of growth)
7. Partnership announcements

Be specific with data points and dates.`,
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
                (mod) => new mod.default({ apiKey: this.config.apiKey })
            );
        }
        return this.clientPromise;
    }

    /**
     * Run a research agent for a specific aspect of deal diligence.
     * Cancellation-aware via AbortSignal.
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

        const userPrompt = `Company: ${companyName}\nFounder(s): ${founderName}\n${additionalContext ? `\nAdditional Context:\n${additionalContext}` : ''}`;

        const openai = await this.getClient();
        const response = await openai.chat.completions.create(
            {
                model: this.config.model || 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.3,
                max_tokens: 2000,
            },
            { signal }
        );

        const content = response.choices[0]?.message?.content || '';

        return {
            summary: content,
            citations: [],
            confidenceScore: 0.7,
        };
    }

    /**
     * Generate an IC memo from research results and meeting notes.
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

        const openai = await this.getClient();
        const response = await openai.chat.completions.create(
            {
                model: this.config.model || 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `You are a venture capital analyst preparing an Investment Committee (IC) memo. Write a professional, concise memo that synthesizes all research into a clear recommendation. 

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

Be direct, data-driven, and highlight both strengths and concerns.`,
                    },
                    {
                        role: 'user',
                        content: `Company: ${companyName}\nFounder(s): ${founderName}\n\n${meetingNotes ? `Meeting Notes:\n${meetingNotes}\n\n` : ''}Research:\n${researchContext}`,
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
