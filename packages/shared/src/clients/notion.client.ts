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
                this.callout('Research will be populated automatically when the deal enters diligence.'),
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
     * Update the 'Stage' and 'Status' text blocks on the deal page.
     * Searches for blocks starting with 'Stage:' or 'Status:' and updates them.
     */
    async updateDealStatus(dealPageId: string, stage: string, status: string): Promise<void> {
        // 1. List blocks to find the Stage and Status paragraphs
        const response = await this.client.blocks.children.list({
            block_id: dealPageId,
        });

        const updates: Promise<any>[] = [];

        for (const block of response.results as any[]) {
            if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
                const text = block.paragraph.rich_text[0].plain_text;

                if (text.startsWith('Stage:')) {
                    updates.push(this.client.blocks.update({
                        block_id: block.id,
                        paragraph: {
                            rich_text: [{ type: 'text', text: { content: `Stage: ${stage}` } }],
                        },
                    }));
                } else if (text.startsWith('Status:')) {
                    updates.push(this.client.blocks.update({
                        block_id: block.id,
                        paragraph: {
                            rich_text: [{ type: 'text', text: { content: `Status: ${status}` } }],
                        },
                    }));
                }
            }
        }

        await Promise.all(updates);
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

    /**
     * Clear all blocks on a page (used to remove placeholders before writing research).
     */
    async clearPageContent(pageId: string): Promise<void> {
        const response = await this.client.blocks.children.list({
            block_id: pageId,
        });

        for (const block of response.results as any[]) {
            try {
                await this.client.blocks.delete({ block_id: block.id });
            } catch {
                // Ignore errors for blocks that can't be deleted
            }
        }
    }

    /**
     * Parse inline markdown (bold, italic) into Notion rich_text objects.
     */
    private parseRichText(text: string): Array<{ type: 'text'; text: { content: string }; annotations?: { bold?: boolean; italic?: boolean } }> {
        const segments: Array<{ type: 'text'; text: { content: string }; annotations?: { bold?: boolean; italic?: boolean } }> = [];

        // Match **bold**, *italic*, or plain text segments
        const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            if (match[2]) {
                // **bold**
                segments.push({
                    type: 'text',
                    text: { content: match[2] },
                    annotations: { bold: true },
                });
            } else if (match[3]) {
                // *italic*
                segments.push({
                    type: 'text',
                    text: { content: match[3] },
                    annotations: { italic: true },
                });
            } else if (match[4]) {
                // plain text
                segments.push({
                    type: 'text',
                    text: { content: match[4] },
                });
            }
        }

        if (segments.length === 0) {
            segments.push({ type: 'text', text: { content: text } });
        }

        return segments;
    }

    /**
     * Create a block with rich text (supports bold/italic).
     */
    private richParagraph(text: string): BlockObjectRequest {
        return {
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: this.parseRichText(text) },
        } as BlockObjectRequest;
    }

    private richBullet(text: string): BlockObjectRequest {
        return {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: this.parseRichText(text) },
        } as BlockObjectRequest;
    }

    private richNumbered(text: string): BlockObjectRequest {
        return {
            object: 'block',
            type: 'numbered_list_item',
            numbered_list_item: { rich_text: this.parseRichText(text) },
        } as BlockObjectRequest;
    }

    /**
     * Parse markdown-style text into proper Notion blocks.
     * Supports: ## headings, ### headings, - bullets, numbered lists, **bold**, *italic*, and paragraphs.
     */
    markdownToBlocks(markdown: string): BlockObjectRequest[] {
        const blocks: BlockObjectRequest[] = [];
        const lines = markdown.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // ## Heading 2
            if (line.startsWith('## ')) {
                blocks.push(this.heading2(line.slice(3).trim()));
            }
            // ### Heading 3
            else if (line.startsWith('### ')) {
                blocks.push(this.heading3(line.slice(4).trim()));
            }
            // # Heading 1 (treat as heading 2 in Notion)
            else if (line.startsWith('# ')) {
                blocks.push(this.heading2(line.slice(2).trim()));
            }
            // - Bullet or * Bullet (but not ** which is bold)
            else if (/^-\s/.test(line) || /^\*\s[^*]/.test(line)) {
                const text = line.replace(/^[-*]\s+/, '');
                if (text.length > 2000) {
                    blocks.push(this.richBullet(text.substring(0, 2000)));
                } else {
                    blocks.push(this.richBullet(text));
                }
            }
            // Numbered list (1. 2. 3. etc)
            else if (/^\d+\.\s/.test(line)) {
                const text = line.replace(/^\d+\.\s+/, '');
                blocks.push(this.richNumbered(text.length > 2000 ? text.substring(0, 2000) : text));
            }
            // --- or *** divider
            else if (/^[-*]{3,}$/.test(line)) {
                blocks.push(this.divider());
            }
            // Regular paragraph
            else {
                if (line.length > 2000) {
                    let remaining = line;
                    while (remaining.length > 0) {
                        blocks.push(this.richParagraph(remaining.substring(0, 2000)));
                        remaining = remaining.substring(2000);
                    }
                } else {
                    blocks.push(this.richParagraph(line));
                }
            }
        }

        return blocks;
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

    numberedList(text: string): BlockObjectRequest {
        return {
            object: 'block',
            type: 'numbered_list_item',
            numbered_list_item: {
                rich_text: [{ type: 'text', text: { content: text } }],
            },
        };
    }
}
