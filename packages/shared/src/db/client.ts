import { Pool, PoolConfig } from 'pg';

let pool: Pool | null = null;

export interface DbConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    ssl?: boolean | object;
}

export function getDbConfig(): DbConfig {
    return {
        host: process.env.DATABASE_HOST || 'localhost',
        port: parseInt(process.env.DATABASE_PORT || '5432', 10),
        database: process.env.DATABASE_NAME || 'diligence',
        user: process.env.DATABASE_USER || 'diligence',
        password: process.env.DATABASE_PASSWORD || 'localdev',
        max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };
}

export function getPool(): Pool {
    if (!pool) {
        const config = getDbConfig();
        pool = new Pool(config as PoolConfig);

        pool.on('error', (err) => {
            console.error('[DB] Unexpected pool error:', err.message);
        });
    }
    return pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const p = getPool();
    const result = await p.query(text, params);
    return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const rows = await query<T>(text, params);
    return rows[0] ?? null;
}

export async function execute(text: string, params?: any[]): Promise<number> {
    const p = getPool();
    const result = await p.query(text, params);
    return result.rowCount ?? 0;
}

export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const p = getPool();
    const client = await p.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function closePool(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
