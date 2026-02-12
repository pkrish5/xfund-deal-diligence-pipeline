import {
    logger,
    dealsRepo,
    workflowRunsRepo,
    idempotencyRepo,
    createTasksEnqueuer,
    AsanaClient,
    NotionClient,
    getSecret,
    type StageKey,
} from '@xfund/shared';

const tasksEnqueuer = createTasksEnqueuer();

/**
 * STAGE_ACTION handler
 * Payload: { taskGid, stageKey, sectionGid, modifiedAt, previousStage? }
 *
 * Dispatches to stage-specific automation:
 * - FIRST_MEETING: Notion pages, prep subtasks
 * - IN_DILIGENCE: parallel research agents, human subtasks
 * - IC_REVIEW: memo draft, checklist
 * - PASS: cancel running workflows, finalize
 */
export async function handleStageAction(
    tenantId: string,
    payload: {
        taskGid: string;
        stageKey: string;
        sectionGid: string;
        modifiedAt: string;
        previousStage?: string;
    }
): Promise<void> {
    const { taskGid, stageKey, sectionGid, modifiedAt, previousStage } = payload;
    const log = logger.child({ tenantId, taskGid, stageKey, jobType: 'STAGE_ACTION' });

    // Idempotency check
    const idemKey = idempotencyRepo.stageActionKey(taskGid, sectionGid, modifiedAt);
    const isNew = await idempotencyRepo.claimKey(idemKey);
    if (!isNew) {
        log.info('Duplicate stage action, skipping');
        return;
    }

    // Find the deal by Asana task GID
    const deal = await dealsRepo.getDealByAsanaTask(taskGid);
    if (!deal) {
        log.warn('No deal found for task, skipping stage action');
        return;
    }

    // Update deal stage
    await dealsRepo.updateDealStage(deal.id, stageKey);

    // Sync status to Notion
    if (deal.notion_deal_page_id) {
        try {
            const notion = new NotionClient({
                token: await getSecret('NOTION_TOKEN'),
                parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
            });

            const statusMap: Record<string, string> = {
                FIRST_MEETING: 'Idle',
                IN_DILIGENCE: 'Active',
                IC_REVIEW: 'Reviewing',
                PASS: 'Passed',
                ARCHIVE: 'Archived',
            };

            await notion.updateDealStatus(
                deal.notion_deal_page_id,
                stageKey,
                statusMap[stageKey] || 'Unknown'
            );
        } catch (err: any) {
            log.warn('Failed to sync status to Notion', { error: err.message });
        }
    }

    // If leaving IN_DILIGENCE or entering PASS, cancel any running workflows
    if (
        previousStage === 'IN_DILIGENCE' ||
        stageKey === 'PASS' ||
        stageKey === 'ARCHIVE'
    ) {
        const cancelledCount = await workflowRunsRepo.requestCancellation(deal.id);
        if (cancelledCount > 0) {
            log.info('Cancelled running workflows', { cancelledCount });
        }
    }

    // Create workflow run
    const run = await workflowRunsRepo.createRun({
        tenantId,
        dealId: deal.id,
        taskGid,
        stageKey,
    });

    log.info('Workflow run created', { runId: run.id, stageKey });

    try {
        switch (stageKey as StageKey) {
            case 'FIRST_MEETING':
                await handleFirstMeeting(tenantId, deal, taskGid, run.id, log);
                break;
            case 'IN_DILIGENCE':
                await handleInDiligence(tenantId, deal, taskGid, run.id, log);
                break;
            case 'IC_REVIEW':
                await handleICReview(tenantId, deal, taskGid, run.id, log);
                break;
            case 'PASS':
                await handlePass(tenantId, deal, taskGid, run.id, log);
                break;
            case 'ARCHIVE':
                await handlePass(tenantId, deal, taskGid, run.id, log); // Same as PASS
                break;
            default:
                log.warn('Unknown stage key', { stageKey });
        }

        await workflowRunsRepo.completeRun(run.id, 'succeeded');
        log.info('Workflow run completed', { runId: run.id });
    } catch (err: any) {
        await workflowRunsRepo.completeRun(run.id, 'failed', { error: err.message });
        throw err;
    }
}

async function handleFirstMeeting(
    tenantId: string,
    deal: any,
    taskGid: string,
    runId: string,
    log: any
): Promise<void> {
    const asana = new AsanaClient({ token: await getSecret('ASANA_TOKEN') });

    // Ensure Notion pages exist (they should from deal creation, but be safe)
    if (!deal.notion_deal_page_id) {
        log.warn('No Notion workspace for deal — it should have been created on deal insert');
    }

    // Create prep subtasks in Asana
    const subtasks = [
        'Review company website & product',
        'Research founder background',
        'Prepare meeting agenda & questions',
        'Check for existing portfolio conflicts',
    ];

    for (const name of subtasks) {
        try {
            await asana.createSubtask(taskGid, name);
        } catch (err: any) {
            log.warn('Failed to create subtask', { name, error: err.message });
        }
    }

    // Update Asana task status
    try {
        await asana.updateTask(taskGid, {
            notes: `${deal.company_name || 'Deal'} — First Meeting\n\nNotion: ${deal.notion_urls?.dealHome || 'N/A'}`,
        });
    } catch (err: any) {
        log.warn('Failed to update task notes', { error: err.message });
    }

    log.info('FIRST_MEETING stage actions completed');
}

async function handleInDiligence(
    tenantId: string,
    deal: any,
    taskGid: string,
    runId: string,
    log: any
): Promise<void> {
    const asana = new AsanaClient({ token: await getSecret('ASANA_TOKEN') });

    // Fetch meeting notes from Notion if available
    let additionalContext = '';
    if (deal.notion_urls) {
        try {
            const notionUrls = typeof deal.notion_urls === 'string'
                ? JSON.parse(deal.notion_urls)
                : deal.notion_urls;

            const meetingNotesUrl = notionUrls.meetingNotes;
            if (meetingNotesUrl) {
                const notion = new NotionClient({
                    token: await getSecret('NOTION_TOKEN'),
                    parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
                });

                // Extract page ID from URL
                const match = meetingNotesUrl.match(/([a-f0-9]{32})/);
                if (match) {
                    const pageId = match[1];
                    const notes = await notion.getPageContent(pageId);
                    if (notes) {
                        additionalContext = `Meeting Notes:\n${notes}`;
                        log.info('Fetched meeting notes for context', { length: notes.length });
                    }
                }
            }
        } catch (err: any) {
            log.warn('Failed to fetch meeting notes', { error: err.message });
        }
    }

    // Clear the research page before spawning agents (remove placeholders)
    if (deal.notion_urls) {
        try {
            const notionUrls = typeof deal.notion_urls === 'string'
                ? JSON.parse(deal.notion_urls)
                : deal.notion_urls;

            const researchUrl = notionUrls.research;
            if (researchUrl) {
                const notion = new NotionClient({
                    token: await getSecret('NOTION_TOKEN'),
                    parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
                });
                const researchMatch = researchUrl.match(/([a-f0-9]{32})/);
                if (researchMatch) {
                    await notion.clearPageContent(researchMatch[1]);
                    log.info('Cleared research page placeholders');
                }
            }
        } catch (err: any) {
            log.warn('Failed to clear research page', { error: err.message });
        }
    }

    // Spawn parallel research batch
    await tasksEnqueuer.enqueue({
        jobType: 'RESEARCH_BATCH',
        tenantId,
        payload: {
            runId,
            dealId: deal.id,
            companyName: deal.company_name || 'Unknown Company',
            founderName: deal.founder_name || 'Unknown Founder',
            additionalContext, // Pass notes to agent
        },
    });

    log.info('Research batch spawned');

    // Create human diligence subtasks
    const humanSubtasks = [
        'Deep-dive product demo / trial',
        'Customer reference calls (2-3)',
        'Financial model review',
        'Legal / IP review',
        'Technical architecture review',
    ];

    for (const name of humanSubtasks) {
        try {
            await asana.createSubtask(taskGid, name);
        } catch (err: any) {
            log.warn('Failed to create human subtask', { name, error: err.message });
        }
    }

    log.info('IN_DILIGENCE stage actions completed');
}

async function handleICReview(
    tenantId: string,
    deal: any,
    taskGid: string,
    runId: string,
    log: any
): Promise<void> {
    const asana = new AsanaClient({ token: await getSecret('ASANA_TOKEN') });

    // Generate IC memo
    await tasksEnqueuer.enqueue({
        jobType: 'MEMO_GENERATE',
        tenantId,
        payload: {
            runId,
            dealId: deal.id,
            companyName: deal.company_name || 'Unknown Company',
            founderName: deal.founder_name || 'Unknown Founder',
        },
    });

    // Create checklist subtasks
    const checklistItems = [
        'IC Memo draft completed',
        'All research sections reviewed',
        'Financial model finalized',
        'Term sheet draft (if proceed)',
        'IC presentation prepared',
    ];

    for (const name of checklistItems) {
        try {
            await asana.createSubtask(taskGid, name);
        } catch (err: any) {
            log.warn('Failed to create checklist subtask', { name, error: err.message });
        }
    }

    log.info('IC_REVIEW stage actions completed');
}

async function handlePass(
    tenantId: string,
    deal: any,
    taskGid: string,
    runId: string,
    log: any
): Promise<void> {
    const asana = new AsanaClient({ token: await getSecret('ASANA_TOKEN') });

    // Cancel any running workflows (already done above, but double-check)
    await workflowRunsRepo.requestCancellation(deal.id);

    // Update Notion status
    if (deal.notion_deal_page_id) {
        try {
            const notion = new NotionClient({
                token: await getSecret('NOTION_TOKEN'),
                parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
            });

            await notion.appendBlocks(deal.notion_deal_page_id, [
                notion.divider(),
                notion.callout('This deal has been PASSED.', '🛑'),
            ]);
        } catch (err: any) {
            log.warn('Failed to update Notion', { error: err.message });
        }
    }

    // Mark Asana task as completed
    try {
        await asana.updateTask(taskGid, { completed: true });
    } catch (err: any) {
        log.warn('Failed to complete Asana task', { error: err.message });
    }

    log.info('PASS stage actions completed');
}
