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

const BASE_ANALYST_PROMPT = `Act as a venture capital analyst preparing an investment diligence report.
Instructions:
- Format your output in markdown: use ### for section headings, - for bullet points, and **bold** for emphasis.
- Write in concise, analytical bullet points (no paragraphs).
- Quantify claims wherever possible (metrics, growth rates, market size, pricing, headcount, traction, etc.).
- After each bullet, include the source in parentheses (e.g., (meeting notes), (company website), (Crunchbase), (news: outlet, date), (LinkedIn)).
- Separate facts from interpretation (label opinions as "Assessment").
- Highlight key risks, open questions, and diligence gaps.
- Call out red flags and assumptions explicitly.
- Use all available information: meeting notes, web search results, public data, and your training knowledge.
- Only write "Insufficient data found" if you truly cannot find ANY relevant information after searching.
- When using your general knowledge, note it as (general knowledge) to distinguish from verified sources.
- No fluff. Prioritize investor-relevant signals over narrative.`;

const RESEARCH_PROMPTS: Record<string, string> = {
    market_tam: `${BASE_ANALYST_PROMPT}

Analyze the market opportunity and Total Addressable Market (TAM). Provide:
1. Market size estimates with sources
2. Growth rate and trends
3. Key market drivers
4. TAM/SAM/SOM breakdown`,

    competitors: `${BASE_ANALYST_PROMPT}

Analyze the competitive landscape. Provide:
1. Direct competitors and their funding/stage
2. Indirect competitors
3. Competitive advantages/disadvantages
4. Market positioning map`,

    founder_background: `${BASE_ANALYST_PROMPT}

Research the founder(s) background. Provide:
1. Educational background
2. Previous work experience
3. Previous startups or exits
4. Domain expertise relevance
5. Notable achievements or connections`,

    risks_redflags: `${BASE_ANALYST_PROMPT}

Identify potential risks and red flags. Provide:
1. Market risks
2. Execution risks
3. Regulatory risks
4. Technology risks
5. Team risks
6. Financial/business model risks
Rate each risk as Low/Medium/High.`,

    product_defensibility: `${BASE_ANALYST_PROMPT}

Analyze the product and defensibility. Provide:
1. Product description and value proposition
2. Technical moat (if any)
3. Network effects
4. Switching costs
5. IP/patents
6. Data advantages`,

    traction_signals: `${BASE_ANALYST_PROMPT}

Analyze traction signals. Look for:
1. Revenue or growth metrics
2. User/customer counts
3. Press coverage and media mentions
4. App store rankings
5. Social media presence
6. Partnership announcements`,
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
     * Run a research agent using OpenAI Responses API with web search.
     * The model will search the web in real-time for current information.
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

        const openai = await this.getClient();

        // Use the Responses API with web_search_preview tool
        const response = await openai.responses.create(
            {
                model: this.config.model || 'gpt-4o',
                instructions: systemPrompt,
                input: userPrompt,
                tools: [{ type: 'web_search_preview' }],
                temperature: 0.3,
            },
            { signal }
        );

        // Extract text content from the response output items
        let content = '';
        const citations: ResearchResult['citations'] = [];

        for (const item of response.output || []) {
            if (item.type === 'message') {
                for (const block of item.content || []) {
                    if (block.type === 'output_text') {
                        content += block.text || '';
                        // Extract inline citations/annotations if present
                        for (const annotation of block.annotations || []) {
                            if (annotation.type === 'url_citation') {
                                citations.push({
                                    title: annotation.title || 'Source',
                                    url: annotation.url,
                                    confidence: 0.85,
                                });
                            }
                        }
                    }
                }
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

        const openai = await this.getClient();
        const response = await openai.chat.completions.create(
            {
                model: this.config.model || 'gpt-4o',
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
