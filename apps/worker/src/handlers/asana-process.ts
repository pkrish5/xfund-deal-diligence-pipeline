import {
    logger,
    AsanaClient,
    asanaTaskStateRepo,
    pipelineSectionsRepo,
    createTasksEnqueuer,
    getSecret,
} from '@xfund/shared';

const tasksEnqueuer = createTasksEnqueuer();

/**
 * ASANA_PROCESS handler
 * Payload: { taskGid, projectGid, action, parentGid? }
 *
 * 1. Fetch task details from Asana (memberships → current section)
 * 2. Compare with asana_task_state → detect section change
 * 3. If changed → enqueue STAGE_ACTION
 */
export async function handleAsanaProcess(
    tenantId: string,
    payload: { taskGid: string; projectGid: string; action?: string }
): Promise<void> {
    const { taskGid, projectGid } = payload;
    const log = logger.child({ tenantId, taskGid, projectGid, jobType: 'ASANA_PROCESS' });

    const asana = new AsanaClient({
        token: await getSecret('ASANA_TOKEN'),
    });

    // Fetch task details
    log.info('Fetching task details from Asana');
    const task = await asana.getTask(taskGid);

    // Find the membership for our pipeline project
    const membership = task.memberships.find(
        (m) => m.project.gid === projectGid
    );

    if (!membership) {
        log.warn('Task is not in the pipeline project, skipping');
        return;
    }

    const currentSectionGid = membership.section.gid;
    const modifiedAt = new Date(task.modified_at);

    log.info('Task section detected', {
        section: membership.section.name,
        sectionGid: currentSectionGid,
    });

    // Detect section change
    const changeResult = await asanaTaskStateRepo.upsertAndDetectChange({
        tenantId,
        taskGid,
        projectGid,
        currentSectionGid,
        modifiedAt,
    });

    if (!changeResult.changed) {
        log.info('No section change detected, skipping');
        return;
    }

    // Resolve stage key for the new section
    const stageKey = await pipelineSectionsRepo.getStageForSection(
        tenantId,
        projectGid,
        currentSectionGid
    );

    if (!stageKey) {
        log.warn('Section not mapped to a stage key, skipping', {
            sectionGid: currentSectionGid,
        });
        return;
    }

    log.info('Section change detected, enqueuing STAGE_ACTION', {
        from: changeResult.previousSectionGid,
        to: currentSectionGid,
        stageKey,
    });

    // Enqueue STAGE_ACTION
    await tasksEnqueuer.enqueue({
        jobType: 'STAGE_ACTION',
        tenantId,
        payload: {
            taskGid,
            sectionGid: currentSectionGid,
            stageKey,
            modifiedAt: modifiedAt.toISOString(),
            previousStage: changeResult.previousStage,
        },
    });

    // Update triggered stage
    await asanaTaskStateRepo.setTriggeredStage(tenantId, taskGid, projectGid, stageKey);
}
