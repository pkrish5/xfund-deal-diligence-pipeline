import { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

/**
 * Middleware that verifies the request came from an authorized Google Cloud identity.
 * For Cloud Run private services, Cloud Run itself validates the OIDC token
 * and sets the `X-Serverless-Authorization` header. We just verify it's present
 * and optionally check the audience.
 *
 * In local dev mode (LOCAL_DEV=true), this middleware is a no-op.
 */
export function requireAuth() {
    return (req: Request, res: Response, next: NextFunction): void => {
        // Skip auth in local dev
        if (process.env.LOCAL_DEV === 'true') {
            return next();
        }

        // Cloud Run automatically validates OIDC tokens on private services.
        // The identity is available in these headers:
        const authHeader = req.headers['authorization'];

        if (!authHeader) {
            logger.warn('Request rejected: missing Authorization header', {
                path: req.path,
                method: req.method,
            });
            res.status(401).json({ error: 'Unauthorized: missing credentials' });
            return;
        }

        // In Cloud Run, if the service is set to "require authentication",
        // invalid tokens are rejected at the load balancer level (403).
        // If we reach this point with an auth header, the token was valid.
        // We can optionally decode it to get the caller identity.

        next();
    };
}

/**
 * Middleware to extract request context for logging.
 */
export function requestContext() {
    return (req: Request, _res: Response, next: NextFunction): void => {
        // Extract trace context from Cloud Run header
        const traceHeader = req.headers['x-cloud-trace-context'] as string;
        if (traceHeader) {
            process.env._TRACE_CONTEXT = traceHeader;
        }

        next();
    };
}
