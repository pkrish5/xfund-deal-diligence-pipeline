import {
    logger,
    NotionClient,
    dealsRepo,
    workflowRunsRepo,
    createTasksEnqueuer,
    getSecret,
} from '@xfund/shared';
import * as agentOutputsRepo from '@xfund/shared/src/db/repos/agent-outputs.repo.js';
import { runDomainAgent, type DomainAgentConfig } from '@xfund/shared/src/agents/domain-agent.js';
import { createSynthesisClient } from '@xfund/shared/src/clients/synthesis-llm.client.js';
import { RESEARCH_ORDER, AGENT_DISPLAY_TITLES, type AgentKey } from '@xfund/shared/src/agents/types.js';

const tasksEnqueuer = createTasksEnqueuer();

/**
 * RESEARCH_BATCH handler (v2 — multi-agent pipeline)
 * Payload: { runId, dealId, companyName, founderName, additionalContext }
 *
 * Two-phase domain agents:
 *   Phase 1: Perplexity web search (parallel)
 *   Phase 2: Anthropic/OpenAI structured analysis with strategy (parallel)
 *
 * After all 9 agents complete:
 *   1. Store structured outputs in DB
 *   2. Write summaries to Notion research page
 *   3. Chain to VERIFY
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

    const isCancelled = await workflowRunsRepo.isCancelRequested(runId);
    if (isCancelled) {
        log.info('Research batch cancelled before start');
        return;
    }

    log.info('Starting research batch (9 two-phase domain agents)', { companyName });

    const abortController = new AbortController();
    const cancelCheckInterval = setInterval(async () => {
        try {
            if (await workflowRunsRepo.isCancelRequested(runId)) {
                log.info('Cancellation requested, aborting batch');
                abortController.abort();
                clearInterval(cancelCheckInterval);
            }
        } catch {}
    }, 5000);

    try {
        const perplexityApiKey = await getSecret('PERPLEXITY_API_KEY');
        const synthesisClient = await createSynthesisClient(getSecret);

        const agentConfig: DomainAgentConfig = {
            perplexityApiKey,
            synthesisClient,
        };

        // Launch all 9 domain agents in parallel
        const promises = RESEARCH_ORDER.map(async (agentKey: AgentKey) => {
            try {
                const result = await runDomainAgent(agentConfig, {
                    agentKey,
                    companyName,
                    founderName,
                    additionalContext,
                    signal: abortController.signal,
                });

                log.info(`Agent completed: ${agentKey}`, {
                    score: result.output.provisionalScore,
                    findings: result.output.findings.length,
                    strategy: result.output.metadata.strategy,
                    turns: result.output.metadata.turnsUsed,
                });

                return { agentKey, result, success: true as const };
            } catch (err: any) {
                log.error(`Agent failed: ${agentKey}`, { error: err.message });
                return { agentKey, error: err, success: false as const };
            }
        });

        const results = await Promise.all(promises);
        log.info('All domain agents finished');

        // Store structured outputs in DB
        for (const item of results) {
            if (item.success) {
                try {
                    await agentOutputsRepo.saveOutput({
                        runId,
                        dealId,
                        agentKey: item.agentKey,
                        phase: 'research',
                        output: item.result.output as any,
                        rawResponse: item.result.rawSearchResponse,
                        modelUsed: item.result.output.metadata.model,
                        strategyUsed: item.result.output.metadata.strategy,
                        tokensUsed: item.result.totalTokens,
                    });
                } catch (err: any) {
                    log.warn(`Failed to store output for ${item.agentKey}`, { error: err.message });
                }
            }
        }
        log.info('Structured outputs stored in DB');

        // Write to Notion in strict order
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

                for (const item of results) {
                    if (item.success && item.result) {
                        const agentTitle = AGENT_DISPLAY_TITLES[item.agentKey as AgentKey] || item.agentKey;
                        const output = item.result.output;

                        try {
                            const blocks: any[] = [
                                notion.heading2(`${agentTitle} [${output.provisionalScore}]`),
                            ];

                            // Summary
                            const summaryBlocks = notion.markdownToBlocks(output.summary);
                            blocks.push(...summaryBlocks);

                            // Key findings
                            if (output.findings.length > 0) {
                                blocks.push(notion.heading3('Key Findings'));
                                for (const f of output.findings) {
                                    const conf = f.confidence === 'high' ? '🟢' : f.confidence === 'medium' ? '🟡' : '🔴';
                                    blocks.push(notion.bulletedList(
                                        `${conf} ${f.claim} — ${f.evidence.slice(0, 300)}`
                                    ));
                                }
                            }

                            // Gaps & assumptions
                            if (output.gaps.length > 0) {
                                blocks.push(notion.heading3('Gaps'));
                                for (const g of output.gaps) {
                                    blocks.push(notion.bulletedList(g));
                                }
                            }

                            // Citations
                            if (output.rawCitations.length > 0) {
                                blocks.push(notion.heading3('Sources'));
                                for (const c of output.rawCitations) {
                                    blocks.push(notion.bulletedList(
                                        `${c.title}${c.url ? ` — ${c.url}` : ''}`
                                    ));
                                }
                            }

                            blocks.push(notion.divider());
                            await notion.appendBlocks(pageId, blocks);
                        } catch (err: any) {
                            log.warn(`Failed to write section ${item.agentKey}`, { error: err.message });
                        }
                    }
                }
                log.info('Research written to Notion in order');
            }
        }

        // Chain to VERIFY
        await tasksEnqueuer.enqueue({
            jobType: 'VERIFY',
            tenantId,
            payload: { runId, dealId, companyName, founderName },
        });
        log.info('Verification step enqueued');

    } catch (err: any) {
        if (err.name === 'AbortError') return;
        throw err;
    } finally {
        clearInterval(cancelCheckInterval);
    }
}

function extractPageId(urlOrId: string): string {
    const match = urlOrId.match(/([a-f0-9]{32})/);
    return match ? match[1] : urlOrId;
}
