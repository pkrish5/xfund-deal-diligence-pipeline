const secretCache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let clientPromise: Promise<any> | null = null;

function getClient(): Promise<any> {
    if (!clientPromise) {
        clientPromise = import('@google-cloud/secret-manager').then(
            (mod) => new mod.SecretManagerServiceClient()
        );
    }
    return clientPromise;
}

/**
 * Access a secret from Google Cloud Secret Manager.
 * Caches values in memory for CACHE_TTL_MS to avoid repeated API calls.
 *
 * In local dev mode, reads from environment variables instead.
 */
export async function getSecret(secretName: string): Promise<string> {
    // Local dev: read from env
    if (process.env.LOCAL_DEV === 'true') {
        const envValue = process.env[secretName];
        if (!envValue) {
            throw new Error(`Secret ${secretName} not found in environment`);
        }
        return envValue;
    }

    // Check cache
    const cached = secretCache.get(secretName);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }

    // Fetch from Secret Manager
    const projectId = process.env.PROJECT_ID;
    if (!projectId) {
        throw new Error('PROJECT_ID environment variable is required');
    }

    const client = await getClient();
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    const value = version.payload?.data?.toString() || '';

    // Cache it
    secretCache.set(secretName, {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return value;
}

/**
 * Clear the secret cache (useful for testing or forced refresh).
 */
export function clearSecretCache(): void {
    secretCache.clear();
}
