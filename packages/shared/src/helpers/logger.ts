export interface LogEntry {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    timestamp: string;
    service?: string;
    requestId?: string;
    tenantId?: string;
    jobType?: string;
    dealId?: string;
    taskGid?: string;
    channelId?: string;
    traceId?: string;
    [key: string]: any;
}

const SERVICE_NAME = process.env.SERVICE_NAME || 'unknown';

function formatEntry(level: LogEntry['level'], message: string, extra?: Record<string, any>): LogEntry {
    const entry: LogEntry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        service: SERVICE_NAME,
        ...extra,
    };

    // Extract Cloud Trace ID from env if available (set by Cloud Run)
    const traceHeader = process.env._TRACE_CONTEXT || '';
    if (traceHeader) {
        const [traceId] = traceHeader.split('/');
        entry.traceId = `projects/${process.env.PROJECT_ID}/traces/${traceId}`;
    }

    return entry;
}

function emit(entry: LogEntry): void {
    const output = JSON.stringify(entry);
    if (entry.level === 'error') {
        console.error(output);
    } else if (entry.level === 'warn') {
        console.warn(output);
    } else {
        console.log(output);
    }
}

export const logger = {
    debug(message: string, extra?: Record<string, any>): void {
        emit(formatEntry('debug', message, extra));
    },
    info(message: string, extra?: Record<string, any>): void {
        emit(formatEntry('info', message, extra));
    },
    warn(message: string, extra?: Record<string, any>): void {
        emit(formatEntry('warn', message, extra));
    },
    error(message: string, extra?: Record<string, any>): void {
        emit(formatEntry('error', message, extra));
    },

    /**
     * Create a child logger with bound context fields.
     */
    child(context: Record<string, any>) {
        return {
            debug: (msg: string, extra?: Record<string, any>) =>
                logger.debug(msg, { ...context, ...extra }),
            info: (msg: string, extra?: Record<string, any>) =>
                logger.info(msg, { ...context, ...extra }),
            warn: (msg: string, extra?: Record<string, any>) =>
                logger.warn(msg, { ...context, ...extra }),
            error: (msg: string, extra?: Record<string, any>) =>
                logger.error(msg, { ...context, ...extra }),
        };
    },
};
