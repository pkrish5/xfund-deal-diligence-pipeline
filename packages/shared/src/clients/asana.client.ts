import crypto from 'crypto';

export interface AsanaConfig {
    token: string;
    baseUrl?: string;
}

export interface AsanaTask {
    gid: string;
    name: string;
    notes: string;
    assignee: { gid: string; name: string } | null;
    memberships: Array<{
        project: { gid: string; name: string };
        section: { gid: string; name: string };
    }>;
    custom_fields: Array<{
        gid: string;
        name: string;
        display_value: string | null;
        text_value?: string | null;
        enum_value?: { gid: string; name: string } | null;
    }>;
    modified_at: string;
    completed: boolean;
}

export interface AsanaSection {
    gid: string;
    name: string;
}

export interface AsanaWebhookResponse {
    gid: string;
    resource: { gid: string; name: string };
    target: string;
    active: boolean;
}

export class AsanaClient {
    private token: string;
    private baseUrl: string;

    constructor(config: AsanaConfig) {
        this.token = config.token;
        this.baseUrl = config.baseUrl || 'https://app.asana.com/api/1.0';
    }

    private async request<T>(
        method: string,
        path: string,
        body?: any,
        queryParams?: Record<string, string>
    ): Promise<T> {
        const url = new URL(`${this.baseUrl}${path}`);
        if (queryParams) {
            Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, v));
        }

        const res = await fetch(url.toString(), {
            method,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: body ? JSON.stringify({ data: body }) : undefined,
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Asana API ${method} ${path} failed (${res.status}): ${errBody}`);
        }

        const json = (await res.json()) as { data: T };
        return json.data;
    }

    /**
     * Get task details including memberships (projects + sections).
     */
    async getTask(taskGid: string): Promise<AsanaTask> {
        return this.request<AsanaTask>('GET', `/tasks/${taskGid}`, undefined, {
            opt_fields: 'name,notes,assignee,assignee.name,memberships.project,memberships.project.name,memberships.section,memberships.section.name,custom_fields,custom_fields.name,custom_fields.display_value,custom_fields.text_value,custom_fields.enum_value,custom_fields.enum_value.name,modified_at,completed',
        });
    }

    /**
     * Create a task in a project, optionally in a specific section.
     */
    async createTask(input: {
        projectGid: string;
        sectionGid?: string;
        name: string;
        notes?: string;
        customFields?: Record<string, string>;
    }): Promise<{ gid: string }> {
        const body: any = {
            name: input.name,
            notes: input.notes || '',
            projects: [input.projectGid],
        };

        if (input.customFields) {
            body.custom_fields = input.customFields;
        }

        const task = await this.request<{ gid: string }>('POST', '/tasks', body);

        // Move to section if specified
        if (input.sectionGid) {
            await this.addTaskToSection(task.gid, input.sectionGid);
        }

        return task;
    }

    /**
     * Add task to a section (moves it within the project).
     */
    async addTaskToSection(taskGid: string, sectionGid: string): Promise<void> {
        await this.request('POST', `/sections/${sectionGid}/addTask`, {
            task: taskGid,
        });
    }

    /**
     * Update task fields.
     */
    async updateTask(
        taskGid: string,
        updates: { name?: string; notes?: string; completed?: boolean; custom_fields?: Record<string, string> }
    ): Promise<void> {
        await this.request('PUT', `/tasks/${taskGid}`, updates);
    }

    /**
     * Create a subtask under a parent task.
     */
    async createSubtask(parentTaskGid: string, name: string, notes?: string): Promise<{ gid: string }> {
        return this.request<{ gid: string }>('POST', `/tasks/${parentTaskGid}/subtasks`, {
            name,
            notes: notes || '',
        });
    }

    /**
     * Get all sections for a project (used for pipeline mapping).
     */
    async getSections(projectGid: string): Promise<AsanaSection[]> {
        return this.request<AsanaSection[]>('GET', `/projects/${projectGid}/sections`);
    }

    /**
     * Create a webhook subscription on a project.
     * Asana will POST to the target URL with X-Hook-Secret for handshake.
     */
    async createWebhook(
        resourceGid: string,
        targetUrl: string
    ): Promise<AsanaWebhookResponse> {
        return this.request<AsanaWebhookResponse>('POST', '/webhooks', {
            resource: resourceGid,
            target: targetUrl,
            filters: [
                { resource_type: 'task', action: 'changed', fields: ['memberships'] },
                { resource_type: 'task', action: 'added' },
            ],
        });
    }

    /**
     * Delete a webhook subscription.
     */
    async deleteWebhook(webhookGid: string): Promise<void> {
        await this.request('DELETE', `/webhooks/${webhookGid}`);
    }

    /**
     * Verify Asana webhook signature.
     * Asana signs the raw body with HMAC-SHA256 using the X-Hook-Secret.
     */
    static verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
        const computed = crypto
            .createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');
        return crypto.timingSafeEqual(
            Buffer.from(computed, 'hex'),
            Buffer.from(signature, 'hex')
        );
    }
}
