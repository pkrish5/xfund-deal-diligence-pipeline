import {
    logger,
    LLMClient,
    NotionClient,
    dealsRepo,
    workflowRunsRepo,
    getSecret,
} from '@xfund/shared';

const RESEARCH_ORDER = [
    'market_tam',
    'competitors',
    'founder_background',
    'risks_redflags',
    'product_defensibility',
    'traction_signals',
];

/**
 * RESEARCH_BATCH handler
 * Payload: { runId, dealId, companyName, founderName, additionalContext }
 *
 * 1. Spawn all 6 research agents in PARALLEL
 * 2. Wait for all to finish (Promise.allSettled)
 * 3. Write results to Notion in STRICT ORDER
 */
export async function handleResearchBatch(
    tenantId: string,
    payload: {
        runId: string;
        dealId: string;
        companyName: string;
        founderName: string;
        additionalContext?: string;
    }
): Promise<void> {
    const { runId, dealId, companyName, founderName, additionalContext } = payload;
    const log = logger.child({ tenantId, runId, dealId, jobType: 'RESEARCH_BATCH' });

    // Check cancellation
    const isCancelled = await workflowRunsRepo.isCancelRequested(runId);
    if (isCancelled) {
        log.info('Research batch cancelled before start');
        return;
    }

    log.info('Starting research batch (6 parallel agents)', { companyName });

    // Create AbortController
    const abortController = new AbortController();
    const cancelCheckInterval = setInterval(async () => {
        try {
            if (await workflowRunsRepo.isCancelRequested(runId)) {
                log.info('Cancellation requested, aborting batch');
                abortController.abort();
                clearInterval(cancelCheckInterval);
            }
        } catch { }
    }, 5000);

    try {
        // Initialize LLM client
        const llm = new LLMClient({
            apiKey: await getSecret('OPENAI_API_KEY'),
            model: process.env.LLM_MODEL || 'gpt-4o',
        });

        // 1. Launch all agents in parallel
        const promises = RESEARCH_ORDER.map(async (agentKey) => {
            try {
                const result = await llm.runResearch(
                    agentKey,
                    companyName,
                    founderName,
                    additionalContext || '',
                    abortController.signal
                );
                return { agentKey, result, success: true };
            } catch (err: any) {
                log.error(`Agent failed: ${agentKey}`, { error: err.message });
                return { agentKey, error: err, success: false };
            }
        });

        // 2. Wait for all
        const results = await Promise.all(promises);
        log.info('All research agents finished');

        // 3. Write to Notion in strict order
        const deal = await dealsRepo.getDealById(dealId);
        if (deal?.notion_urls) {
            const notionUrls = typeof deal.notion_urls === 'string'
                ? JSON.parse(deal.notion_urls)
                : deal.notion_urls;

            const researchPageId = notionUrls.research;
            if (researchPageId) {
                const notion = new NotionClient({
                    token: await getSecret('NOTION_TOKEN'),
                    parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
                });

                const pageId = extractPageId(researchPageId);

                // Write each successful result in order
                for (const item of results) {
                    if (item.success && item.result) {
                        const agentTitle = formatAgentTitle(item.agentKey!);
                        const contentBlocks = notion.markdownToBlocks(item.result.summary);

                        try {
                            await notion.appendBlocks(pageId, [
                                notion.heading2(`${agentTitle}`),
                                ...contentBlocks,
                                ...(item.result.citations.length > 0
                                    ? [
                                        notion.heading3('Sources'),
                                        ...item.result.citations.map((c) =>
                                            notion.bulletedList(`${c.title}${c.url ? ` — ${c.url}` : ''}`)
                                        ),
                                    ]
                                    : []),
                                notion.divider(),
                            ]);
                        } catch (err: any) {
                            log.warn(`Failed to write section ${item.agentKey}`, { error: err.message });
                        }
                    }
                }
                log.info('Research written to Notion in order');
            }
        }

    } catch (err: any) {
        if (err.name === 'AbortError') return;
        throw err;
    } finally {
        clearInterval(cancelCheckInterval);
    }
}

function formatAgentTitle(agentKey: string): string {
    const titles: Record<string, string> = {
        market_tam: 'Market & TAM Analysis',
        competitors: 'Competitive Landscape',
        founder_background: 'Founder Background',
        risks_redflags: 'Risks & Red Flags',
        product_defensibility: 'Product & Defensibility',
        traction_signals: 'Traction Signals',
    };
    return titles[agentKey] || agentKey;
}

function extractPageId(urlOrId: string): string {
    const match = urlOrId.match(/([a-f0-9]{32})/);
    return match ? match[1] : urlOrId;
}
