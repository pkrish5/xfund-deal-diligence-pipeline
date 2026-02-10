// Re-export all shared modules for convenient imports

// Database
export { getPool, query, queryOne, execute, withTransaction, closePool } from './db/client.js';
export { runMigrations } from './db/migrate.js';

// Repos
export * as dealsRepo from './db/repos/deals.repo.js';
export * as gcalWatchesRepo from './db/repos/gcal-watches.repo.js';
export * as asanaTaskStateRepo from './db/repos/asana-task-state.repo.js';
export * as pipelineSectionsRepo from './db/repos/pipeline-sections.repo.js';
export type { StageKey } from './db/repos/pipeline-sections.repo.js';
export * as workflowRunsRepo from './db/repos/workflow-runs.repo.js';
export * as idempotencyRepo from './db/repos/idempotency.repo.js';
export * as integrationsRepo from './db/repos/integrations.repo.js';

// Clients
export { GCalClient, parseCalendlyEvent, isCalendlyEvent, isDealEvent } from './clients/gcal.client.js';
export { AsanaClient } from './clients/asana.client.js';
export { NotionClient } from './clients/notion.client.js';
export {
    CloudTasksEnqueuer,
    LocalTasksEnqueuer,
    createTasksEnqueuer,
    type JobType,
    type TaskPayload,
} from './clients/tasks.client.js';
export { LLMClient } from './clients/llm.client.js';

// Helpers
export { logger } from './helpers/logger.js';
export { requireAuth, requestContext } from './helpers/auth-middleware.js';
export { getSecret, clearSecretCache } from './helpers/secrets.js';
