/**
 * One-time script to get a Google Calendar OAuth refresh token.
 * 
 * Usage:
 *   npx tsx scripts/get-gcal-token.ts
 * 
 * It will:
 * 1. Open your browser to Google's consent screen
 * 2. Start a local server on port 3000 to catch the redirect
 * 3. Exchange the auth code for tokens
 * 4. Print the refresh token to paste into .env
 */

import http from 'http';
import { URL } from 'url';
import { exec } from 'child_process';

const CLIENT_ID = process.env.GCAL_OAUTH_CLIENT_ID || '1077932923534-2i37s5ffcj19l1sfq0s7if1kgjfrh1t9.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.GCAL_OAUTH_CLIENT_SECRET || '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';
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
];

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // Force refresh token generation

console.log('\n🔐 Google Calendar OAuth Token Generator\n');
console.log('Opening browser for Google sign-in...\n');

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:3000`);

    if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
    }

    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h1>❌ Authorization failed</h1><p>Error: ${error}</p>`);
        console.error(`\n❌ Authorization failed: ${error}`);
        process.exit(1);
    }

    if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>❌ No authorization code received</h1>');
        return;
    }

    // Exchange auth code for tokens
    try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
            }),
        });

        const tokens = await tokenResponse.json() as any;

        if (tokens.error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<h1>❌ Token exchange failed</h1><p>${tokens.error_description || tokens.error}</p>`);
            console.error(`\n❌ Token exchange failed: ${tokens.error_description || tokens.error}`);
            process.exit(1);
        }

        // Success!
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
      <h1>✅ Success!</h1>
      <p>You can close this tab and return to your terminal.</p>
    `);

        console.log('✅ Tokens received!\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Add these to your .env file:\n');
        console.log(`GCAL_OAUTH_CLIENT_ID=${CLIENT_ID}`);
        console.log(`GCAL_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}`);
        console.log(`GCAL_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        if (!tokens.refresh_token) {
            console.log('⚠️  No refresh token in response. This can happen if you\'ve already authorized.');
            console.log('   Go to https://myaccount.google.com/permissions and revoke access to this app,');
            console.log('   then run this script again.\n');
        }

        // Shut down after a short delay
        setTimeout(() => {
            server.close();
            process.exit(0);
        }, 1000);
    } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>❌ Error</h1><p>${err.message}</p>`);
        console.error(`\n❌ Error: ${err.message}`);
        process.exit(1);
    }
});

server.listen(3000, () => {
    console.log(`Listening on http://localhost:3000 for OAuth callback...\n`);

    // Open browser
    const openCommand = process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';

    exec(`${openCommand} "${authUrl.toString()}"`);

    console.log('If the browser didn\'t open, visit this URL manually:');
    console.log(authUrl.toString());
    console.log('');
});
