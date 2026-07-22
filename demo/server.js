#!/usr/bin/env node
// Local demo harness for oauth2-oidc-pkce-client. Zero dependencies — only Node built-ins.
//
// Runs two HTTP servers on two different ports, on purpose: a real identity
// provider is always a different origin than your app, and this package's
// popup flow checks the message's origin, so a same-origin demo wouldn't
// actually exercise the real code path.
//
//   APP_PORT (4000) — serves demo/public/*  and  ../dist/*  as static files
//   IDP_PORT (4001) — a mock OpenID Connect provider: discovery, /authorize
//                      (a real login page), /token (real PKCE + nonce
//                      handling), /userinfo, /revoke
//
// Run:  node demo/server.js
// Then open http://localhost:4000

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

const APP_PORT = 4000;
const IDP_PORT = 4001;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const IDP_ORIGIN = `http://localhost:${IDP_PORT}`;

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function base64url(buffer) {
    return buffer.toString('base64url');
}

function jsonResponse(res, status, body, extraHeaders = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), ...extraHeaders });
    res.end(payload);
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

function log(scope, message) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] [${scope}] ${message}`);
}

// ---------------------------------------------------------------------------
// APP server — static files only (demo/public/* and the built package)
// ---------------------------------------------------------------------------

const appServer = createServer(async (req, res) => {
    const url = new URL(req.url, APP_ORIGIN);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    const fromDist = pathname.startsWith('/dist/');
    const root = fromDist ? DIST_DIR : PUBLIC_DIR;
    const relative = fromDist ? pathname.slice('/dist/'.length) : pathname.slice(1);
    const filePath = path.join(root, relative);

    if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    try {
        const data = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Not found: ${pathname}`);
    }
});

// ---------------------------------------------------------------------------
// MOCK IDP server — discovery, authorize (real login page), token (real
// PKCE + nonce), userinfo, revoke. All state lives in memory and resets
// whenever this process restarts — there's nothing to configure or clean up.
// ---------------------------------------------------------------------------

/** code -> { codeChallenge, redirectUri, scope, nonce, clientId, sub, email } — deleted on first use. */
const pendingCodes = new Map();
/** access_token -> { sub, email, scope } */
const accessTokens = new Map();
/** refresh_token -> { sub, email, scope } */
const refreshTokens = new Map();

const DISCOVERY_DOCUMENT = {
    issuer: IDP_ORIGIN,
    authorization_endpoint: `${IDP_ORIGIN}/authorize`,
    token_endpoint: `${IDP_ORIGIN}/token`,
    userinfo_endpoint: `${IDP_ORIGIN}/userinfo`,
    revocation_endpoint: `${IDP_ORIGIN}/revoke`,
};

function withCors(res) {
    res.setHeader('Access-Control-Allow-Origin', APP_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function renderLoginPage(params) {
    const { clientId, redirectUri, scope, state, nonce, codeChallenge } = params;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in — Demo Identity Provider</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #EEF1F6; font-family: 'IBM Plex Sans', -apple-system, Segoe UI, sans-serif; color: #1A2233;
  }
  .card {
    width: min(380px, 92vw); background: #FFFFFF; border-radius: 14px; padding: 32px;
    box-shadow: 0 1px 2px rgba(20,25,40,0.06), 0 12px 32px rgba(20,25,40,0.10); border: 1px solid #E3E7EF;
  }
  .idp-badge {
    display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600;
    color: #2D5BFF; letter-spacing: 0.02em; text-transform: uppercase; margin-bottom: 18px;
  }
  .idp-badge .dot { width: 8px; height: 8px; border-radius: 50%; background: #2D5BFF; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p.sub { margin: 0 0 22px; font-size: 14px; color: #5B647A; line-height: 1.5; }
  .req { background: #F5F7FB; border: 1px solid #E3E7EF; border-radius: 10px; padding: 12px 14px; margin-bottom: 22px; font-size: 13px; color: #444E63; }
  .req b { color: #1A2233; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #33394A; }
  input[type=email] {
    width: 100%; padding: 11px 12px; border-radius: 8px; border: 1.5px solid #D7DCE6; font-size: 14px;
    margin-bottom: 20px; font-family: inherit; color: #1A2233;
  }
  input[type=email]:focus { outline: none; border-color: #2D5BFF; box-shadow: 0 0 0 3px rgba(45,91,255,0.15); }
  .row { display: flex; gap: 10px; flex-direction: row-reverse; }
  button {
    flex: 1; padding: 11px 14px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600;
    cursor: pointer; font-family: inherit;
  }
  button.approve { background: #2D5BFF; color: white; }
  button.approve:hover { background: #234BDB; }
  button.deny { background: transparent; color: #5B647A; border: 1.5px solid #D7DCE6; }
  button.deny:hover { background: #F5F7FB; }
  .fine { margin-top: 18px; font-size: 11.5px; color: #97A0B3; text-align: center; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <div class="idp-badge"><span class="dot"></span>Demo Identity Provider</div>
    <h1>Sign in to continue</h1>
    <p class="sub">An application is requesting access to your account.</p>
    <div class="req"><b>${escapeHtml(clientId)}</b> is requesting scope: <b>${escapeHtml(scope)}</b></div>
    <form method="POST" action="/authorize/approve">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
      <input type="hidden" name="scope" value="${escapeHtml(scope)}" />
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <input type="hidden" name="nonce" value="${escapeHtml(nonce ?? '')}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
      <label for="email">Email</label>
      <input type="email" id="email" name="email" value="demo@example.com" required />
      <div class="row">
        <button class="approve" type="submit" name="decision" value="approve">Continue</button>
        <button class="deny" type="submit" name="decision" value="deny">Deny</button>
      </div>
    </form>
    <div class="fine">This is a local mock IdP — nothing here is a real account.<br />Origin: ${escapeHtml(IDP_ORIGIN)}</div>
  </div>
</body>
</html>`;
}

const idpServer = createServer(async (req, res) => {
    const url = new URL(req.url, IDP_ORIGIN);

    if (req.method === 'OPTIONS') {
        withCors(res);
        res.writeHead(204).end();
        return;
    }

    // --- Discovery ---------------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
        log('idp', 'GET /.well-known/openid-configuration');
        withCors(res);
        jsonResponse(res, 200, DISCOVERY_DOCUMENT);
        return;
    }

    // --- Authorize (renders the login page) ---------------------------------
    if (req.method === 'GET' && url.pathname === '/authorize') {
        const p = url.searchParams;
        log('idp', `GET /authorize  client_id=${p.get('client_id')} scope=${p.get('scope')}`);

        if (p.get('response_type') !== 'code' || !p.get('code_challenge') || p.get('code_challenge_method') !== 'S256') {
            res.writeHead(400, { 'Content-Type': 'text/plain' }).end('invalid_request: expected response_type=code and code_challenge_method=S256');
            return;
        }

        const html = renderLoginPage({
            clientId: p.get('client_id') ?? '',
            redirectUri: p.get('redirect_uri') ?? '',
            scope: p.get('scope') ?? '',
            state: p.get('state') ?? '',
            nonce: p.get('nonce'),
            codeChallenge: p.get('code_challenge') ?? '',
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
    }

    // --- Approve/deny from the login page's form -----------------------------
    if (req.method === 'POST' && url.pathname === '/authorize/approve') {
        const body = new URLSearchParams(await readBody(req));
        const redirectUri = body.get('redirect_uri') ?? '';
        const state = body.get('state') ?? '';

        if (body.get('decision') !== 'approve') {
            log('idp', 'User denied the request');
            const to = new URL(redirectUri);
            to.searchParams.set('error', 'access_denied');
            to.searchParams.set('error_description', 'The user denied the request');
            if (state) to.searchParams.set('state', state);
            res.writeHead(302, { Location: to.toString() }).end();
            return;
        }

        const code = base64url(randomBytes(24));
        pendingCodes.set(code, {
            codeChallenge: body.get('code_challenge') ?? '',
            redirectUri,
            scope: body.get('scope') ?? '',
            nonce: body.get('nonce') || undefined,
            clientId: body.get('client_id') ?? '',
            sub: 'demo-user-1',
            email: body.get('email') || 'demo@example.com',
        });

        log('idp', `Approved — issuing code ${code.slice(0, 8)}…`);
        const to = new URL(redirectUri);
        to.searchParams.set('code', code);
        if (state) to.searchParams.set('state', state);
        res.writeHead(302, { Location: to.toString() }).end();
        return;
    }

    // --- Token ---------------------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/token') {
        withCors(res);
        const body = new URLSearchParams(await readBody(req));
        const grantType = body.get('grant_type');

        if (grantType === 'authorization_code') {
            const code = body.get('code') ?? '';
            const pending = pendingCodes.get(code);
            pendingCodes.delete(code); // single-use, whether or not it turns out valid

            if (!pending) {
                log('idp', `POST /token  ✗ unknown or already-used code`);
                jsonResponse(res, 400, { error: 'invalid_grant', error_description: 'Unknown or already-used authorization code' });
                return;
            }
            if (pending.redirectUri !== body.get('redirect_uri')) {
                log('idp', `POST /token  ✗ redirect_uri mismatch`);
                jsonResponse(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri does not match the authorization request' });
                return;
            }

            const verifier = body.get('code_verifier') ?? '';
            const computedChallenge = base64url(createHash('sha256').update(verifier).digest());
            if (computedChallenge !== pending.codeChallenge) {
                log('idp', `POST /token  ✗ PKCE check FAILED (code_verifier does not hash to code_challenge)`);
                jsonResponse(res, 400, { error: 'invalid_grant', error_description: 'code_verifier does not match code_challenge' });
                return;
            }
            log('idp', `POST /token  ✓ PKCE verified`);

            const accessToken = base64url(randomBytes(24));
            const refreshToken = base64url(randomBytes(24));
            accessTokens.set(accessToken, { sub: pending.sub, email: pending.email, scope: pending.scope });
            refreshTokens.set(refreshToken, { sub: pending.sub, email: pending.email, scope: pending.scope });

            const now = Math.floor(Date.now() / 1000);
            const idTokenHeader = base64url(Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })));
            const idTokenPayload = base64url(
                Buffer.from(
                    JSON.stringify({
                        iss: IDP_ORIGIN,
                        aud: pending.clientId,
                        sub: pending.sub,
                        email: pending.email,
                        name: 'Demo User',
                        nonce: pending.nonce,
                        iat: now,
                        exp: now + 300,
                    }),
                ),
            );
            const idToken = `${idTokenHeader}.${idTokenPayload}.demo-unsigned`;

            log('idp', `POST /token  ✓ issued tokens for ${pending.email} (nonce=${pending.nonce ? pending.nonce.slice(0, 8) + '…' : 'none'})`);
            jsonResponse(res, 200, {
                access_token: accessToken,
                refresh_token: refreshToken,
                id_token: idToken,
                token_type: 'Bearer',
                expires_in: 3600,
                scope: pending.scope,
            });
            return;
        }

        if (grantType === 'refresh_token') {
            const refreshToken = body.get('refresh_token') ?? '';
            const stored = refreshTokens.get(refreshToken);
            if (!stored) {
                log('idp', 'POST /token (refresh)  ✗ unknown refresh_token');
                jsonResponse(res, 400, { error: 'invalid_grant', error_description: 'Unknown refresh_token' });
                return;
            }
            const accessToken = base64url(randomBytes(24));
            accessTokens.set(accessToken, stored);
            log('idp', `POST /token (refresh)  ✓ issued a new access_token for ${stored.email}`);
            jsonResponse(res, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, scope: stored.scope });
            return;
        }

        jsonResponse(res, 400, { error: 'unsupported_grant_type', error_description: `grant_type "${grantType}" is not supported by this mock IdP` });
        return;
    }

    // --- Userinfo --------------------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/userinfo') {
        withCors(res);
        const auth = req.headers.authorization ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
        const stored = accessTokens.get(token);
        if (!stored) {
            log('idp', 'GET /userinfo  ✗ invalid or missing access_token');
            jsonResponse(res, 401, { error: 'invalid_token', error_description: 'Access token is missing, invalid, or expired' });
            return;
        }
        log('idp', `GET /userinfo  ✓ ${stored.email}`);
        jsonResponse(res, 200, { sub: stored.sub, email: stored.email, name: 'Demo User' });
        return;
    }

    // --- Revoke ------------------------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/revoke') {
        withCors(res);
        const body = new URLSearchParams(await readBody(req));
        const token = body.get('token') ?? '';
        const existed = accessTokens.delete(token) || refreshTokens.delete(token);
        log('idp', `POST /revoke  ${existed ? '✓ revoked' : '(token already unknown, per RFC 7009 still returns 200)'}`);
        res.writeHead(200).end();
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${req.method} ${url.pathname}`);
});

// ---------------------------------------------------------------------------

appServer.listen(APP_PORT, () => {
    console.log(`\n  App:  ${APP_ORIGIN}`);
});
idpServer.listen(IDP_PORT, () => {
    console.log(`  IdP:  ${IDP_ORIGIN}  (mock — discovery, authorize, token, userinfo, revoke)\n`);
    console.log(`  Open ${APP_ORIGIN} in your browser to try it. Ctrl+C to stop.\n`);
});
