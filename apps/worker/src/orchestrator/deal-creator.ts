import {
    logger,
    AsanaClient,
    NotionClient,
    dealsRepo,
    pipelineSectionsRepo,
    getSecret,
} from '@xfund/shared';

interface ParsedEvent {
    companyName: string | null;
    founderName: string | null;
    meetingTime: string | null;
    meetingLink: string | null;
    attendees: string[];
    description: string;
}

/**
 * Creates a full "Deal Object":
 * 1. Asana task in the FIRST_MEETING section with template fields
 * 2. Notion deal workspace (Deal Home + 5 child pages)
 * 3. Cross-links: Notion URL in Asana notes, all IDs stored in deals table
 */
export async function createDealObject(
    tenantId: string,
    dealId: string,
    parsed: ParsedEvent
): Promise<void> {
    const log = logger.child({ tenantId, dealId, jobType: 'DEAL_CREATE' });
    const company = parsed.companyName || 'Unknown Company';
    const founder = parsed.founderName || 'Unknown Founder';
    const taskName = `${company} — ${founder}`;

    log.info('Creating deal object', { company, founder });

    // --- 1. Create Notion workspace ---
    let notionWorkspace;
    try {
        const notion = new NotionClient({
            token: await getSecret('NOTION_TOKEN'),
            parentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
        });

        notionWorkspace = await notion.createDealWorkspace(company, founder, {
            meetingTime: parsed.meetingTime || undefined,
            meetingLink: parsed.meetingLink || undefined,
            attendees: parsed.attendees,
            source: 'GCal / Calendly',
        });

        log.info('Notion workspace created', {
            dealPageId: notionWorkspace.dealPageId,
        });

        // Store Notion info in deals table
        await dealsRepo.updateDealNotion(
            dealId,
            notionWorkspace.dealPageId,
            notionWorkspace.urls
        );
    } catch (err: any) {
        log.error('Failed to create Notion workspace', { error: err.message });
        // Continue — Asana task can still be created
    }

    // --- 2. Create Asana task ---
    try {
        const asana = new AsanaClient({
            token: await getSecret('ASANA_TOKEN'),
        });

        const projectGid = process.env.ASANA_PIPELINE_PROJECT_GID || process.env.ASANA_PROJECT_GID || '';

        // Find FIRST_MEETING section
        const firstMeetingSection = await pipelineSectionsRepo.getSectionForStage(
            tenantId,
            projectGid,
            'FIRST_MEETING'
        );

        // Build task notes
        const noteLines = [
            `📋 Deal: ${company}`,
            `👤 Founder: ${founder}`,
            `📅 Source: GCal / Calendly`,
        ];

        if (parsed.meetingTime) {
            noteLines.push(`🕐 Meeting: ${parsed.meetingTime}`);
        }
        if (parsed.meetingLink) {
            noteLines.push(`🔗 Meeting Link: ${parsed.meetingLink}`);
        }
        if (parsed.attendees.length > 0) {
            noteLines.push(`👥 Attendees: ${parsed.attendees.join(', ')}`);
        }
        if (notionWorkspace) {
            noteLines.push('');
            noteLines.push(`📓 Notion Workspace: ${notionWorkspace.urls.dealHome}`);
        }
        if (parsed.description) {
            noteLines.push('');
            noteLines.push('--- Description ---');
            // Trim description to avoid huge notes
            const trimmedDesc = parsed.description.length > 1000
                ? parsed.description.substring(0, 1000) + '...'
                : parsed.description;
            noteLines.push(trimmedDesc);
        }

        const task = await asana.createTask({
            projectGid,
            sectionGid: firstMeetingSection || undefined,
            name: taskName,
            notes: noteLines.join('\n'),
        });

        log.info('Asana task created', { taskGid: task.gid });

        // Store Asana task GID in deals table
        await dealsRepo.updateDealAsana(dealId, task.gid);
    } catch (err: any) {
        log.error('Failed to create Asana task', { error: err.message });
    }

    log.info('Deal object creation completed', { dealId });
}
