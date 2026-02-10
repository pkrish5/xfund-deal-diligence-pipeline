import {
    logger,
    LLMClient,
    NotionClient,
    dealsRepo,
    workflowRunsRepo,
    getSecret,
} from '@xfund/shared';

/**
 * RESEARCH_AGENT handler
 * Payload: { runId, agentKey, dealId, companyName, founderName }
 *
 * 1. Check cancel_requested → exit early if true
 * 2. Run LLM-powered research for the agent key
 * 3. Write results to Notion research page
 * 4. Periodically check cancel_requested
 */
export async function handleResearchAgent(
    tenantId: string,
    payload: {
        runId: string;
        agentKey: string;
        dealId: string;
        companyName: string;
        founderName: string;
    }
): Promise<void> {
    const { runId, agentKey, dealId, companyName, founderName } = payload;
    const log = logger.child({ tenantId, runId, agentKey, dealId, jobType: 'RESEARCH_AGENT' });

    // Check cancellation before starting
    const isCancelled = await workflowRunsRepo.isCancelRequested(runId);
    if (isCancelled) {
        log.info('Research agent cancelled before start');
        return;
    }

    log.info('Starting research agent', { agentKey, companyName });

    // Create AbortController for cancellation
    const abortController = new AbortController();

    // Set up periodic cancellation check
    const cancelCheckInterval = setInterval(async () => {
        try {
            const shouldCancel = await workflowRunsRepo.isCancelRequested(runId);
            if (shouldCancel) {
                log.info('Cancellation requested, aborting research');
                abortController.abort();
                clearInterval(cancelCheckInterval);
            }
        } catch (err) {
            // Ignore check errors
        }
    }, 5000); // Check every 5 seconds

    try {
        // Initialize LLM client
        const llm = new LLMClient({
            apiKey: await getSecret('OPENAI_API_KEY'),
            model: process.env.LLM_MODEL || 'gpt-4o',
        });

        // Run research
        const result = await llm.runResearch(
            agentKey,
            companyName,
            founderName,
            '', // Additional context could come from deal notes
            abortController.signal
        );

        log.info('Research completed', {
            agentKey,
            summaryLength: result.summary.length,
            confidence: result.confidenceScore,
        });

        // Write results to Notion
        const deal = await dealsRepo.getDealById(dealId);
        if (deal?.notion_urls) {
            const notionUrls = typeof deal.notion_urls === 'string'
                ? JSON.parse(deal.notion_urls)
                : deal.notion_urls;

            const researchPageId = notionUrls.research;
            if (researchPageId) {
                try {
                    const notion = new NotionClient({
                        token: await getSecret('NOTION_TOKEN'),
                        parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
                    });

                    const agentTitle = formatAgentTitle(agentKey);
                    await notion.appendBlocks(extractPageId(researchPageId), [
                        notion.heading3(`${agentTitle} (AI Research)`),
                        ...notion.createParagraphBlocks(result.summary),
                        ...(result.citations.length > 0
                            ? [
                                notion.heading3('Sources'),
                                ...result.citations.map((c) =>
                                    notion.bulletedList(`${c.title}${c.url ? ` — ${c.url}` : ''} (confidence: ${c.confidence})`)
                                ),
                            ]
                            : []),
                        notion.divider(),
                    ]);

                    log.info('Research written to Notion', { agentKey });
                } catch (err: any) {
                    log.warn('Failed to write research to Notion', { error: err.message });
                }
            }
        }
    } catch (err: any) {
        if (err.name === 'AbortError') {
            log.info('Research agent aborted due to cancellation');
            return;
        }
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
    // If it's a Notion URL, extract the page ID
    const match = urlOrId.match(/([a-f0-9]{32})/);
    return match ? match[1] : urlOrId;
}
