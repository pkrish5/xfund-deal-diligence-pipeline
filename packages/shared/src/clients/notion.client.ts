import { Client } from '@notionhq/client';
import type {
    BlockObjectRequest,
    CreatePageResponse,
} from '@notionhq/client/build/src/api-endpoints.js';

export interface NotionConfig {
    token: string;
    parentPageId: string;
}

export interface DealWorkspace {
    dealPageId: string;
    urls: {
        dealHome: string;
        meetingNotes: string;
        research: string;
        risks: string;
        followUps: string;
        memo: string;
    };
}

export class NotionClient {
    private client: Client;
    private parentPageId: string;

    constructor(config: NotionConfig) {
        this.client = new Client({ auth: config.token });
        this.parentPageId = config.parentPageId;
    }

    /**
     * Create a full deal workspace with child pages under a parent.
     * Structure:
     *   Deal Home: "{Company} — {Founder}"
     *     ├── Meeting Notes
     *     ├── Research
     *     ├── Risks
     *     ├── Follow-ups
     *     └── Memo / IC Summary
     */
    async createDealWorkspace(
        companyName: string,
        founderName: string,
        metadata?: {
            meetingTime?: string;
            meetingLink?: string;
            attendees?: string[];
            source?: string;
        }
    ): Promise<DealWorkspace> {
        const title = `${companyName} — ${founderName}`;

        // Create Deal Home page
        const dealPage = await this.createPage(this.parentPageId, title, [
            this.heading2('Deal Overview'),
            this.paragraph(`**Company:** ${companyName}`),
            this.paragraph(`**Founder:** ${founderName}`),
            this.paragraph(`**Source:** ${metadata?.source || 'GCal'}`),
            ...(metadata?.meetingTime
                ? [this.paragraph(`**Meeting Time:** ${metadata.meetingTime}`)]
                : []),
            ...(metadata?.meetingLink
                ? [this.paragraph(`**Meeting Link:** ${metadata.meetingLink}`)]
                : []),
            ...(metadata?.attendees?.length
                ? [this.paragraph(`**Attendees:** ${metadata.attendees.join(', ')}`)]
                : []),
            this.divider(),
            this.heading2('Status'),
            this.paragraph('Stage: FIRST_MEETING'),
            this.paragraph('Status: Idle'),
        ]);

        const dealPageId = dealPage.id;
        const dealHomeUrl = (dealPage as any).url || '';

        // Create child pages
        const [meetingNotes, research, risks, followUps, memo] = await Promise.all([
            this.createPage(dealPageId, '📝 Meeting Notes', [
                this.heading2('Meeting Notes'),
                this.paragraph('_Add meeting notes here..._'),
            ]),
            this.createPage(dealPageId, '🔍 Research', [
                this.heading2('Research'),
                this.callout('Research results will be populated automatically when the deal enters diligence.'),
                this.divider(),
                this.heading3('Market & TAM'),
                this.paragraph('_Pending..._'),
                this.heading3('Competitors'),
                this.paragraph('_Pending..._'),
                this.heading3('Founder Background'),
                this.paragraph('_Pending..._'),
                this.heading3('Product & Defensibility'),
                this.paragraph('_Pending..._'),
                this.heading3('Traction Signals'),
                this.paragraph('_Pending..._'),
            ]),
            this.createPage(dealPageId, '⚠️ Risks & Red Flags', [
                this.heading2('Risks & Red Flags'),
                this.paragraph('_Will be populated during diligence..._'),
            ]),
            this.createPage(dealPageId, '📋 Follow-ups', [
                this.heading2('Follow-ups'),
                this.todo('Schedule follow-up meeting', false),
                this.todo('Request pitch deck', false),
                this.todo('Review financials', false),
            ]),
            this.createPage(dealPageId, '📄 Memo / IC Summary', [
                this.heading2('Investment Committee Memo'),
                this.paragraph('_Memo will be generated when deal enters IC Review stage._'),
            ]),
        ]);

        return {
            dealPageId,
            urls: {
                dealHome: dealHomeUrl,
                meetingNotes: (meetingNotes as any).url || '',
                research: (research as any).url || '',
                risks: (risks as any).url || '',
                followUps: (followUps as any).url || '',
                memo: (memo as any).url || '',
            },
        };
    }

    /**
     * Append content blocks to a page.
     */
    async appendBlocks(pageId: string, blocks: BlockObjectRequest[]): Promise<void> {
        await this.client.blocks.children.append({
            block_id: pageId,
            children: blocks,
        });
    }

    /**
     * Update page properties (title, etc).
     */
    async updatePageTitle(pageId: string, title: string): Promise<void> {
        await this.client.pages.update({
            page_id: pageId,
            properties: {
                title: {
                    title: [{ type: 'text', text: { content: title } }],
                },
            },
        });
    }

    /**
     * Archive (soft-delete) a page.
     */
    async archivePage(pageId: string): Promise<void> {
        await this.client.pages.update({
            page_id: pageId,
            archived: true,
        });
    }

    /**
     * Fetch all text content from a page (recursively fetches blocks).
     */
    async getPageContent(pageId: string): Promise<string> {
        let content = '';
        let hasMore = true;
        let cursor: string | undefined = undefined;

        while (hasMore) {
            const response = await this.client.blocks.children.list({
                block_id: pageId,
                start_cursor: cursor,
            });

            for (const block of response.results as any[]) {
                if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
                    content += block.paragraph.rich_text.map((t: any) => t.plain_text).join('') + '\n\n';
                } else if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
                    const type = block.type;
                    content += block[type].rich_text.map((t: any) => t.plain_text).join('') + '\n';
                } else if (block.type === 'bulleted_list_item') {
                    content += '• ' + block.bulleted_list_item.rich_text.map((t: any) => t.plain_text).join('') + '\n';
                } else if (block.type === 'numbered_list_item') {
                    content += '- ' + block.numbered_list_item.rich_text.map((t: any) => t.plain_text).join('') + '\n';
                }
            }

            hasMore = response.has_more;
            cursor = response.next_cursor || undefined;
        }

        return content.trim();
    }

    // ---- Block builders ----

    private async createPage(
        parentPageId: string,
        title: string,
        children: BlockObjectRequest[]
    ): Promise<CreatePageResponse> {
        return this.client.pages.create({
            parent: { page_id: parentPageId },
            properties: {
                title: {
                    title: [{ type: 'text', text: { content: title } }],
                },
            },
            children,
        });
    }

    heading2(text: string): BlockObjectRequest {
        return {
            object: 'block',
            type: 'heading_2',
            heading_2: {
                rich_text: [{ type: 'text', text: { content: text } }],
            },
        };
    }

    heading3(text: string): BlockObjectRequest {
        return {
            object: 'block',
            type: 'heading_3',
            heading_3: {
                rich_text: [{ type: 'text', text: { content: text } }],
            },
        };
    }

    paragraph(text: string): BlockObjectRequest {
        return {
            object: 'block',
            type: 'paragraph',
            paragraph: {
                rich_text: [{ type: 'text', text: { content: text } }],
            },
        };
    }

    /**
     * Create multiple paragraph blocks for text exceeding 2000 chars.
     * Notion API limit is 2000 chars per text block.
     */
    createParagraphBlocks(text: string): BlockObjectRequest[] {
        const MAX_LENGTH = 2000;
        const blocks: BlockObjectRequest[] = [];
        let remaining = text;

        while (remaining.length > 0) {
            const chunk = remaining.substring(0, MAX_LENGTH);
            remaining = remaining.substring(MAX_LENGTH);
            blocks.push(this.paragraph(chunk));
        }

        return blocks;
    }

    divider(): BlockObjectRequest {
        return {
            object: 'block',
            type: 'divider',
            divider: {},
        };
    }

    callout(text: string, emoji: string = '💡'): BlockObjectRequest {
        return {
            object: 'block',
            type: 'callout',
            callout: {
                rich_text: [{ type: 'text', text: { content: text } }],
                icon: { type: 'emoji', emoji: emoji as any },
            },
        };
    }

    todo(text: string, checked: boolean): BlockObjectRequest {
        return {
            object: 'block',
            type: 'to_do',
            to_do: {
                rich_text: [{ type: 'text', text: { content: text } }],
                checked,
            },
        };
    }

    bulletedList(text: string): BlockObjectRequest {
        return {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
                rich_text: [{ type: 'text', text: { content: text } }],
            },
        };
    }
}
