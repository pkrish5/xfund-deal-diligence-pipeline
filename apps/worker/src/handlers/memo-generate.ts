import {
    logger,
    LLMClient,
    NotionClient,
    dealsRepo,
    workflowRunsRepo,
    getSecret,
} from '@xfund/shared';

/**
 * MEMO_GENERATE handler
 * Payload: { runId, dealId, companyName, founderName }
 *
 * Takes research outputs + meeting notes + template, produces IC memo blocks into Notion.
 */
export async function handleMemoGenerate(
    tenantId: string,
    payload: {
        runId: string;
        dealId: string;
        companyName: string;
        founderName: string;
    }
): Promise<void> {
    const { runId, dealId, companyName, founderName } = payload;
    const log = logger.child({ tenantId, runId, dealId, jobType: 'MEMO_GENERATE' });

    // Check cancellation before starting
    const isCancelled = await workflowRunsRepo.isCancelRequested(runId);
    if (isCancelled) {
        log.info('Memo generation cancelled before start');
        return;
    }

    log.info('Starting memo generation', { companyName });

    const deal = await dealsRepo.getDealById(dealId);
    if (!deal) {
        log.error('Deal not found', { dealId });
        return;
    }

    // Initialize clients
    const llm = new LLMClient({
        apiKey: await getSecret('OPENAI_API_KEY'),
        model: process.env.LLM_MODEL || 'gpt-4o',
    });

    const notion = new NotionClient({
        token: await getSecret('NOTION_TOKEN'),
        parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
    });

    // Gather research data from Notion (simplified: use deal metadata)
    // In a full implementation, we'd read the research page blocks
    const researchSections: Record<string, string> = {
        'Company': `${companyName}, founded by ${founderName}`,
        'Stage': deal.current_stage,
        'Source': deal.source,
    };

    // Generate the memo
    const abortController = new AbortController();

    // Periodic cancellation check
    const cancelCheck = setInterval(async () => {
        try {
            const shouldCancel = await workflowRunsRepo.isCancelRequested(runId);
            if (shouldCancel) {
                abortController.abort();
                clearInterval(cancelCheck);
            }
        } catch (_) { }
    }, 5000);

    try {
        const memo = await llm.generateMemo(
            companyName,
            founderName,
            researchSections,
            '', // Meeting notes
            abortController.signal
        );

        log.info('Memo generated', {
            title: memo.title,
            sectionCount: memo.sections.length,
        });

        // Write memo to Notion
        const notionUrls = typeof deal.notion_urls === 'string'
            ? JSON.parse(deal.notion_urls)
            : deal.notion_urls;

        const memoPageUrl = notionUrls?.memo;
        if (memoPageUrl) {
            const memoPageId = extractPageId(memoPageUrl);

            const blocks = [];
            blocks.push(notion.heading2(memo.title));
            blocks.push(notion.callout(`Generated on ${new Date().toLocaleDateString()}`, '📄'));
            blocks.push(notion.divider());

            for (const section of memo.sections) {
                blocks.push(notion.heading3(section.heading));
                // Split long content into paragraphs
                const paragraphs = section.content.split('\n\n').filter(Boolean);
                for (const p of paragraphs) {
                    blocks.push(notion.paragraph(p));
                }
            }

            blocks.push(notion.divider());
            blocks.push(notion.callout('This memo was AI-generated. Please review and edit before IC presentation.', '⚠️'));

            await notion.appendBlocks(memoPageId, blocks);
            log.info('Memo written to Notion');
        } else {
            log.warn('No memo page URL found for deal');
        }

        // Update deal stage status in Notion deal homepage
        if (deal.notion_deal_page_id) {
            try {
                await notion.appendBlocks(deal.notion_deal_page_id, [
                    notion.divider(),
                    notion.callout('IC Memo has been generated and is ready for review.', '✅'),
                ]);
            } catch (err: any) {
                log.warn('Failed to update deal home page', { error: err.message });
            }
        }
    } catch (err: any) {
        if (err.name === 'AbortError') {
            log.info('Memo generation aborted due to cancellation');
            return;
        }
        throw err;
    } finally {
        clearInterval(cancelCheck);
    }
}

function extractPageId(urlOrId: string): string {
    const match = urlOrId.match(/([a-f0-9]{32})/);
    return match ? match[1] : urlOrId;
}
