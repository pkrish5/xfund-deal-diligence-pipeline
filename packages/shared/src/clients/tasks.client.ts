export type JobType =
    | 'GCAL_SYNC'
    | 'ASANA_PROCESS'
    | 'STAGE_ACTION'
    | 'RESEARCH_AGENT'
    | 'RESEARCH_BATCH'
    | 'MEMO_GENERATE';

const QUEUE_MAP: Record<JobType, string> = {
    GCAL_SYNC: 'q-gcal-sync',
    ASANA_PROCESS: 'q-asana-events',
    STAGE_ACTION: 'q-stage-actions',
    RESEARCH_AGENT: 'q-research',
    RESEARCH_BATCH: 'q-research',
    MEMO_GENERATE: 'q-research',
};

export interface TaskPayload {
    jobType: JobType;
    tenantId: string;
    payload: Record<string, any>;
    idempotencyKey?: string;
}

export interface CloudTasksConfig {
    projectId: string;
    region: string;
    workerUrl: string;
    serviceAccountEmail: string;
}

export interface TasksEnqueuer {
    enqueue(taskPayload: TaskPayload): Promise<string>;
    enqueueMany(tasks: TaskPayload[]): Promise<string[]>;
}

export class CloudTasksEnqueuer implements TasksEnqueuer {
    private config: CloudTasksConfig;
    private clientPromise: Promise<any> | null = null;

    constructor(config: CloudTasksConfig) {
        this.config = config;
    }

    /**
     * Lazily load the Cloud Tasks client (ESM dynamic import).
     */
    private async getClient(): Promise<any> {
        if (!this.clientPromise) {
            this.clientPromise = import('@google-cloud/tasks').then(
                (mod) => new mod.CloudTasksClient()
            );
        }
        return this.clientPromise;
    }

    /**
     * Enqueue a task to the appropriate Cloud Tasks queue.
     * Attaches an OIDC token for authenticating to the worker service.
     */
    async enqueue(taskPayload: TaskPayload): Promise<string> {
        const client = await this.getClient();
        const queueName = QUEUE_MAP[taskPayload.jobType];
        const parent = client.queuePath(
            this.config.projectId,
            this.config.region,
            queueName
        );

        const body = JSON.stringify(taskPayload);

        const [response] = await client.createTask({
            parent,
            task: {
                httpRequest: {
                    httpMethod: 'POST',
                    url: `${this.config.workerUrl}/tasks/dispatch`,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: Buffer.from(body).toString('base64'),
                    oidcToken: {
                        serviceAccountEmail: this.config.serviceAccountEmail,
                        audience: this.config.workerUrl,
                    },
                },
            },
        });

        const taskName = response.name || 'unknown';
        console.log(`[TASKS] Enqueued ${taskPayload.jobType} → ${queueName}: ${taskName}`);
        return taskName;
    }

    async enqueueMany(tasks: TaskPayload[]): Promise<string[]> {
        return Promise.all(tasks.map((t) => this.enqueue(t)));
    }
}

/**
 * Local development stub that calls the worker directly via HTTP.
 */
export class LocalTasksEnqueuer implements TasksEnqueuer {
    private workerUrl: string;

    constructor(workerUrl: string) {
        this.workerUrl = workerUrl;
    }

    async enqueue(taskPayload: TaskPayload): Promise<string> {
        console.log(`[TASKS-LOCAL] Dispatching ${taskPayload.jobType} to ${this.workerUrl}`);

        const res = await fetch(`${this.workerUrl}/tasks/dispatch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskPayload),
        });

        if (!res.ok) {
            throw new Error(`Local task dispatch failed: ${res.status} ${await res.text()}`);
        }

        return `local-${Date.now()}`;
    }

    async enqueueMany(tasks: TaskPayload[]): Promise<string[]> {
        return Promise.all(tasks.map((t) => this.enqueue(t)));
    }
}

/**
 * Factory: returns Cloud Tasks enqueuer in GCP, local HTTP enqueuer for dev.
 */
export function createTasksEnqueuer(): TasksEnqueuer {
    const projectId = process.env.PROJECT_ID;
    const region = process.env.REGION;
    const workerUrl = process.env.WORKER_URL;
    const saEmail = process.env.TASKS_INVOKER_SA_EMAIL;

    if (projectId && region && saEmail && workerUrl && !process.env.LOCAL_DEV) {
        return new CloudTasksEnqueuer({
            projectId,
            region,
            workerUrl,
            serviceAccountEmail: saEmail,
        });
    }

    return new LocalTasksEnqueuer(workerUrl || 'http://localhost:8082');
}
