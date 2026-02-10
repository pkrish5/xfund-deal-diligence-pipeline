import { google, calendar_v3 } from 'googleapis';

export interface GCalConfig {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}

export interface WatchResult {
    channelId: string;
    resourceId: string;
    expirationMs: number;
}

export interface SyncResult {
    events: calendar_v3.Schema$Event[];
    nextSyncToken: string | null;
    fullSync: boolean;
}

export class GCalClient {
    private calendar: calendar_v3.Calendar;

    constructor(config: GCalConfig) {
        const auth = new google.auth.OAuth2(
            config.clientId,
            config.clientSecret
        );
        auth.setCredentials({ refresh_token: config.refreshToken });
        this.calendar = google.calendar({ version: 'v3', auth });
    }

    /**
     * Create a push notification watch on a calendar.
     * Google sends headers-only pings to the webhook URL; we must fetch changes ourselves.
     * Channels do NOT auto-renew; we must replace before expiration.
     */
    async watchEvents(
        calendarId: string,
        webhookUrl: string,
        channelId: string,
        channelToken?: string
    ): Promise<WatchResult> {
        const res = await this.calendar.events.watch({
            calendarId,
            requestBody: {
                id: channelId,
                type: 'web_hook',
                address: webhookUrl,
                token: channelToken,
            },
        });

        return {
            channelId: res.data.id!,
            resourceId: res.data.resourceId!,
            expirationMs: parseInt(res.data.expiration!, 10),
        };
    }

    /**
     * Stop a watch channel. Must provide both channel ID and resource ID.
     */
    async stopChannel(channelId: string, resourceId: string): Promise<void> {
        await this.calendar.channels.stop({
            requestBody: {
                id: channelId,
                resourceId: resourceId,
            },
        });
    }

    /**
     * Incremental sync using a stored syncToken.
     * If the token is invalid (410 GONE), returns { fullSync: true } signal.
     */
    async incrementalSync(
        calendarId: string,
        syncToken: string
    ): Promise<SyncResult | { goneError: true }> {
        try {
            const allEvents: calendar_v3.Schema$Event[] = [];
            let pageToken: string | undefined;
            let nextSyncToken: string | null = null;

            do {
                const res = await this.calendar.events.list({
                    calendarId,
                    syncToken,
                    pageToken,
                    singleEvents: true,
                });

                if (res.data.items) {
                    allEvents.push(...res.data.items);
                }
                pageToken = res.data.nextPageToken ?? undefined;
                if (res.data.nextSyncToken) {
                    nextSyncToken = res.data.nextSyncToken;
                }
            } while (pageToken);

            return { events: allEvents, nextSyncToken, fullSync: false };
        } catch (err: any) {
            if (err.code === 410) {
                return { goneError: true };
            }
            throw err;
        }
    }

    /**
     * Full sync to get all events and obtain a syncToken.
     * Pages through all results.
     */
    async fullSync(calendarId: string): Promise<SyncResult> {
        const allEvents: calendar_v3.Schema$Event[] = [];
        let pageToken: string | undefined;
        let nextSyncToken: string | null = null;

        // Get events from the last 30 days to avoid huge data volumes
        const timeMin = new Date();
        timeMin.setDate(timeMin.getDate() - 30);

        do {
            const res = await this.calendar.events.list({
                calendarId,
                singleEvents: true,
                timeMin: timeMin.toISOString(),
                maxResults: 250,
                pageToken,
            });

            if (res.data.items) {
                allEvents.push(...res.data.items);
            }
            pageToken = res.data.nextPageToken ?? undefined;
            if (res.data.nextSyncToken) {
                nextSyncToken = res.data.nextSyncToken;
            }
        } while (pageToken);

        return { events: allEvents, nextSyncToken, fullSync: true };
    }
}

/**
 * Parse a GCal event to extract company/founder info.
 * Calendly events typically have structured descriptions.
 */
export function parseCalendlyEvent(event: calendar_v3.Schema$Event): {
    companyName: string | null;
    founderName: string | null;
    meetingTime: string | null;
    meetingLink: string | null;
    attendees: string[];
    description: string;
} {
    const summary = event.summary || '';
    const description = event.description || '';
    const attendees = (event.attendees || [])
        .filter((a) => !a.self)
        .map((a) => a.email || a.displayName || 'unknown');

    // Try to extract company and founder from summary
    // Common Calendly patterns: "Meeting with Founder Name" or "Company - Founder Name"
    let companyName: string | null = null;
    let founderName: string | null = null;

    // Pattern: "Company — Founder" or "Company - Founder"
    const dashMatch = summary.match(/^(.+?)\s*[—\-]\s*(.+)$/);
    if (dashMatch) {
        companyName = dashMatch[1].trim();
        founderName = dashMatch[2].trim();
    } else {
        // Use the first non-self attendee's name as founder
        const firstAttendee = (event.attendees || []).find((a) => !a.self);
        if (firstAttendee) {
            founderName = firstAttendee.displayName || firstAttendee.email || null;
        }
        // Use summary as company name fallback
        companyName = summary || null;
    }

    const meetingTime = event.start?.dateTime || event.start?.date || null;
    const meetingLink = event.hangoutLink || event.htmlLink || null;

    return { companyName, founderName, meetingTime, meetingLink, attendees, description };
}

/**
 * The deal tag that marks a calendar event for pipeline processing.
 * Add "[deal]" anywhere in the event title or description.
 * Works for both Calendly-scheduled and manually-created events.
 */
const DEAL_TAG = '[deal]';

/**
 * Check if a calendar event should enter the deal pipeline.
 * Returns true if:
 *   - The event title or description contains "[deal]" (case-insensitive)
 */
export function isDealEvent(event: calendar_v3.Schema$Event): boolean {
    const summary = (event.summary || '').toLowerCase();
    const desc = (event.description || '').toLowerCase();
    const tag = DEAL_TAG.toLowerCase();

    return summary.includes(tag) || desc.includes(tag);
}

/**
 * Check if an event looks like it originated from Calendly.
 */
export function isCalendlyEvent(event: calendar_v3.Schema$Event): boolean {
    const desc = (event.description || '').toLowerCase();
    const location = (event.location || '').toLowerCase();

    return (
        desc.includes('calendly') ||
        desc.includes('calendly.com') ||
        location.includes('calendly')
    );
}
