import type {
    SynthesisLLMConfig,
    SynthesisLLMInterface,
    CompletionParams,
    CompletionResult,
    SynthesisProvider,
} from '../agents/types.js';

const DEFAULT_MODELS: Record<SynthesisProvider, string> = {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
};

export class SynthesisLLMClient implements SynthesisLLMInterface {
    private config: SynthesisLLMConfig;
    private anthropicClient: any | null = null;
    private openaiClient: any | null = null;

    constructor(config: SynthesisLLMConfig) {
        this.config = config;
    }

    getModelName(): string {
        return this.config.model || DEFAULT_MODELS[this.config.provider];
    }

    private async getAnthropicClient(): Promise<any> {
        if (!this.anthropicClient) {
            const mod = await import('@anthropic-ai/sdk');
            this.anthropicClient = new mod.default({ apiKey: this.config.apiKey });
        }
        return this.anthropicClient;
    }

    private async getOpenAIClient(): Promise<any> {
        if (!this.openaiClient) {
            const mod = await import('openai');
            this.openaiClient = new mod.default({ apiKey: this.config.apiKey });
        }
        return this.openaiClient;
    }

    async complete(params: CompletionParams): Promise<CompletionResult> {
        if (this.config.provider === 'anthropic') {
            return this.completeAnthropic(params);
        }
        return this.completeOpenAI(params);
    }

    private async completeAnthropic(params: CompletionParams): Promise<CompletionResult> {
        const client = await this.getAnthropicClient();
        const model = this.getModelName();

        const response = await client.messages.create({
            model,
            max_tokens: params.maxTokens || 4096,
            temperature: params.temperature ?? 0.3,
            system: params.systemPrompt,
            messages: params.messages.map(m => ({
                role: m.role,
                content: m.content,
            })),
        }, {
            signal: params.signal,
        });

        const content = response.content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('');

        const tokensUsed =
            (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

        return { content, tokensUsed };
    }

    private async completeOpenAI(params: CompletionParams): Promise<CompletionResult> {
        const client = await this.getOpenAIClient();
        const model = this.getModelName();

        const messages = [
            { role: 'system' as const, content: params.systemPrompt },
            ...params.messages,
        ];

        const response = await client.chat.completions.create(
            {
                model,
                messages,
                temperature: params.temperature ?? 0.3,
                max_tokens: params.maxTokens || 4096,
                ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
            },
            { signal: params.signal }
        );

        const content = response.choices[0]?.message?.content || '';
        const tokensUsed =
            (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);

        return { content, tokensUsed };
    }
}

/**
 * Factory: create a SynthesisLLMClient from environment config.
 * Reads SYNTHESIS_LLM_PROVIDER and SYNTHESIS_LLM_MODEL from env,
 * and uses getSecret to fetch the appropriate API key.
 */
export async function createSynthesisClient(
    getSecret: (name: string) => Promise<string>
): Promise<SynthesisLLMClient> {
    const provider = (process.env.SYNTHESIS_LLM_PROVIDER || 'anthropic') as SynthesisProvider;

    const keyName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    const apiKey = await getSecret(keyName);

    return new SynthesisLLMClient({
        provider,
        apiKey,
        model: process.env.SYNTHESIS_LLM_MODEL || undefined,
    });
}
