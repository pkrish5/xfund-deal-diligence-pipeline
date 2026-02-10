import * as fs from 'fs';
import * as path from 'path';
import { getPool } from './client.js';

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

interface MigrationRecord {
    version: number;
    name: string;
}

export async function runMigrations(): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();

    try {
        // Ensure schema_migrations table exists
        await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

        // Get applied migrations
        const { rows: applied } = await client.query<MigrationRecord>(
            'SELECT version, name FROM schema_migrations ORDER BY version'
        );
        const appliedVersions = new Set(applied.map((r) => r.version));

        // Read migration files
        const files = fs.readdirSync(MIGRATIONS_DIR)
            .filter((f) => f.endsWith('.sql'))
            .sort();

        for (const file of files) {
            const match = file.match(/^(\d+)_(.+)\.sql$/);
            if (!match) {
                console.warn(`[MIGRATE] Skipping unrecognized file: ${file}`);
                continue;
            }

            const version = parseInt(match[1], 10);
            const name = match[2];

            if (appliedVersions.has(version)) {
                continue;
            }

            console.log(`[MIGRATE] Applying migration ${version}: ${name}`);
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query(
                    'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
                    [version, name]
                );
                await client.query('COMMIT');
                console.log(`[MIGRATE] ✅ Applied migration ${version}: ${name}`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`[MIGRATE] ❌ Failed migration ${version}: ${name}`, err);
                throw err;
            }
        }

        console.log('[MIGRATE] All migrations applied.');
    } finally {
        client.release();
    }
}

// Allow running directly via CLI: tsx packages/shared/src/db/migrate.ts
if (require.main === module) {
    runMigrations()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
