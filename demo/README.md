# Local demo

Runs the real package against a real (mock) identity provider — on its own origin, with real PKCE and nonce validation — entirely on your machine. No account, no signup, no extra `npm install`.

```bash
# from the project root
npm run build     # only needed once, or after you change src/
node demo/server.js
```

Then open **http://localhost:4000**.

## What's running

| Origin                  | What it is                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `http://localhost:4000` | The demo app — plain HTML/JS importing `../dist/index.js` directly via `<script type="module">`, no bundler. |
| `http://localhost:4001` | A mock identity provider — discovery, `/authorize` (a real login page), `/token` (real PKCE + nonce checks), `/userinfo`, `/revoke`. |

Both are one Node process (`demo/server.js`), zero dependencies beyond Node itself. State (issued codes/tokens) lives in memory and resets when you stop the process — there's nothing to clean up between runs.

## Try it

1. Click **Sign in (popup)** — a popup opens on `localhost:4001` showing a login form (pre-filled `demo@example.com`). Click **Continue**.
2. The popup closes itself, the page shows the decoded `id_token` claims and the raw tokens.
3. Try **Get user info**, **Refresh token**, **Sign out (revoke)** — each calls the matching method on `IdpOAuth2Client` and logs the result.
4. Try **Sign in (redirect)** too — full-page navigation instead of a popup, same result.

## Seeing the security checks actually work

The mock IdP does real checks, not theater — open `demo/server.js` and look at the `/token` handler:

- **PKCE:** it recomputes `SHA256(code_verifier)` and compares it to the `code_challenge` from the original request. Change a character in `code_verifier` in `app.js` (client-side) and sign-in will fail with `invalid_grant`.
- **nonce:** the `id_token` it issues echoes back the `nonce` from the authorize request. `IdpOAuth2Client` checks this after every sign-in — this is the exact check that was missing before it got wired up. To see it fail on purpose, edit the `nonce: pending.nonce` line in `/token`'s response to a hardcoded wrong string and sign-in will throw `IdTokenValidationError` instead of silently succeeding.
- **Single-use codes:** the terminal log shows each `code` deleted right after use — replaying an old callback URL fails with `invalid_grant`.

## Using a real provider instead

Swap `IDP_ORIGIN` in `demo/public/app.js` for your real provider's issuer:

```js
const IDP_ORIGIN = 'https://your-real-provider.example';
```

and `clientId: 'demo-client'` inside `makeClient()` for your real client ID. Note `app.js` already uses **two different redirect URIs on purpose** — `popupClient` uses `callback.html`, `redirectClient` uses `/` (this page) — because a shared one is a real bug, not just a style choice: redirect mode needs to land back wherever `handleRedirectCallback()` actually runs (this page), while `callback.html` only knows how to handle the popup postMessage handshake. You'd need to register **both** `http://localhost:4000/callback.html` and `http://localhost:4000/` as allowed redirect URIs with your provider if you want to test both modes.

At that point you can drop the mock IdP half of `demo/server.js` entirely — the demo app itself doesn't care where tokens come from.

