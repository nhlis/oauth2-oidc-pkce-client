# oauth2-oidc-pkce-client

[![npm version](https://shieldcn.dev/npm/v/oauth2-oidc-pkce-client.svg)](https://www.npmjs.com/package/oauth2-oidc-pkce-client)
[![npm downloads](https://shieldcn.dev/npm/dm/oauth2-oidc-pkce-client.svg)](https://www.npmjs.com/package/oauth2-oidc-pkce-client)
[![bundle size](https://shieldcn.dev/bundlephobia/minzip/oauth2-oidc-pkce-client.svg)](https://bundlephobia.com/package/oauth2-oidc-pkce-client)

## In plain terms

Think about the "Sign in with Google" or "Sign in with Microsoft" buttons you've clicked on countless websites. This package is the code that makes a button like that actually work, safely.

- **The problem it solves:** letting someone prove "this is really me" to a website or app, without that site ever seeing or storing the person's password.
- **Who uses it:** developers building a website or app that needs a "Sign in" feature, connecting to whatever login system is already in place (Google, Microsoft, or a company's own custom one).
- **What you'd actually see:** clicking "Sign in" opens the real login screen — Google's own page, or a company's own page. This package never draws its own screens or buttons; it just handles the secure back-and-forth around that moment.
- **Why not just write this by hand?** This part of an app has well-known security pitfalls if built incorrectly. This package follows established industry standards, so a team doesn't have to reinvent — and risk getting wrong — something this sensitive.

That's the whole story at a high level. Everything from here down is technical documentation for the developers who'll actually wire this into an app.

---

A dependency-free browser client implementing the OAuth 2.0 Authorization Code flow with PKCE (RFC 7636). It works against any spec-compliant OIDC provider — Keycloak, Auth0, Okta, Azure AD / Entra ID, Cognito, Ory Hydra, Zitadel, an in-house IdP, whatever — and it has no UI and no framework dependency of any kind.

This package does not render anything. It is a protocol/transport layer, not a component library — the closest comparison is `fetch` or `axios`, not an auth widget. There is no login form, no button, no screen that this package draws for you. Two things actually appear on screen during a login flow, and neither is this package's doing:

1. The identity provider's own sign-in/consent screen — hosted and designed entirely by the provider.
2. Whatever your app builds around this package's methods (`loginWithPopup()`, `getUserInfo()`, a "Sign in" button, a loading state, an authenticated dashboard).

That is also the entire reason it is "framework-agnostic": not because it ships adapters for every framework, but because it never touches rendering at all, so React, Vue, Angular, Svelte, SolidJS, or plain JavaScript all call the same class the same way. See [How it works](#how-it-works) for the full request/redirect sequence.

Summary of what it does and does not do:

- PKCE (S256) by default. No client secret is ever sent — this is a public-client flow only.
- Provider endpoints are resolved via `.well-known/openid-configuration` (OIDC Discovery, RFC 8414) at runtime, or supplied statically for providers that don't expose discovery.
- Popup or full-page redirect, your choice, same API surface either way.
- Zero runtime dependencies. Nothing gets pulled into your bundle beyond this package's own ~2 KB gzip.
- No components, no hooks, no directives, no framework-specific build. One class, six public methods, one helper function for the popup callback page.

---

## Table of contents

- [In plain terms](#in-plain-terms)
- [Installation](#installation)
- [How it works](#how-it-works)
- [1. Register an OAuth2 client with your provider](#1-register-an-oauth2-client-with-your-provider)
- [2. Create a callback page (popup mode only)](#2-create-a-callback-page-popup-mode-only)
- [3. Initialize the client](#3-initialize-the-client)
- [4. Framework usage](#4-framework-usage)
    - [Vanilla JavaScript / TypeScript](#vanilla-javascript--typescript)
    - [React](#react)
    - [Vue 3](#vue-3)
    - [Angular](#angular)
    - [Svelte / SvelteKit](#svelte--sveltekit)
    - [Solid.js](#solidjs)
    - [Next.js (App Router)](#nextjs-app-router)
    - [Nuxt 3](#nuxt-3)
- [Providers without discovery support](#providers-without-discovery-support)
- [Refreshing tokens](#refreshing-tokens)
- [Logout / token revocation](#logout--token-revocation)
- [Token storage guidance](#token-storage-guidance)
- [Error handling](#error-handling)
- [API reference](#api-reference)
- [TypeScript](#typescript)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## Installation

```bash
npm install oauth2-oidc-pkce-client
```

```bash
yarn add oauth2-oidc-pkce-client
```

```bash
pnpm add oauth2-oidc-pkce-client
```

**Want to see it running before wiring it into your app?** `demo/` in this repo is a complete local demo — a real login flow against a mock identity provider, no account needed. `node demo/server.js` after cloning, see [demo/README.md](./demo/README.md).

```bash
bun add oauth2-oidc-pkce-client
```

The package ships both an ESM (`import`) and CJS (`require`) build, plus TypeScript declarations — it works out of the box with Vite, webpack, Next.js, Nuxt, Rollup, esbuild, or a plain `<script type="module">` tag.

## Tooling & footprint

**Built with:**

| Tool                                                                            | Role                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [TypeScript](https://www.typescriptlang.org/)                                   | Source language; strict typing, no `any` in the public API.                                                                                                              |
| [tsup](https://tsup.egoist.dev/) (esbuild under the hood)                       | Bundles `src/` into dual ESM + CJS output with bundled `.d.ts` declarations, source maps, minification, and a clean rebuild each time. See `tsup.config.ts` in the repo. |
| Native `fetch`, `URL`, `URLSearchParams`, `crypto.subtle`, `window.postMessage` | All discovery, token exchange, PKCE hashing, and popup messaging use standard browser/runtime APIs — no HTTP client or polyfill library is bundled.                      |

**Runtime dependencies: zero.** Check `package.json` yourself — `dependencies` is empty. `devDependencies` lists `tsup` and `typescript` (build) plus `vitest` and `jsdom` (tests) — all build/test-time only, never shipped to consumers.

**What actually ships, measured from the published `dist/` output:**

| File                      | Purpose                          | Minified | Gzipped |
| ------------------------- | --------------------------------- | -------- | ------- |
| `dist/index.js` (ESM)     | Main `IdpOAuth2Client` + types   | ~7.8 KB  | ~3.0 KB |
| `dist/index.cjs` (CJS)    | Same, CommonJS build             | ~8.4 KB  | ~3.3 KB |
| `dist/callback.js` (ESM)  | `handleOAuth2PopupCallback` only | ~0.4 KB  | ~0.3 KB |
| `dist/callback.cjs` (CJS) | Same, CommonJS build             | ~0.9 KB  | ~0.5 KB |

Because `"sideEffects": false` is set and the two entry points (`.` for the main client, `./callback` for the popup-page helper) are exported separately, bundlers that tree-shake (Vite, webpack 5+, Rollup) only pull in `callback.js` on the one static page that imports it — the rest of your app importing `IdpOAuth2Client` never pays for it.

**Package registry snapshot** (from the [npm package page](https://www.npmjs.com/package/oauth2-oidc-pkce-client), version `0.1.1`):

| Metric               | Value |
| -------------------- | ----- |
| Weekly downloads     | 291   |
| Runtime dependencies | 0     |
| Dependents           | 0     |
| Published versions   | 2     |
| License              | MIT   |
| Open issues / PRs    | 0 / 0 |

This is a point-in-time snapshot taken shortly after the `0.1.1` release — weekly downloads in particular will keep changing, so treat the links below as the source of truth going forward, not this table:

- **Downloads over time:** [npm-stat.com/charts.html?package=oauth2-oidc-pkce-client](https://npm-stat.com/charts.html?package=oauth2-oidc-pkce-client), or run `npm view oauth2-oidc-pkce-client` for current metadata.
- **Bundle size / cost in your own bundler:** [bundlephobia.com/package/oauth2-oidc-pkce-client](https://bundlephobia.com/package/oauth2-oidc-pkce-client).
- **Dependency tree:** run `npm ls oauth2-oidc-pkce-client` in a project that installed it, or `npm view oauth2-oidc-pkce-client dependencies` — both should print an empty object, confirming zero transitive runtime dependencies.

## How it works

This library doesn't wrap or depend on React, Vue, or any other UI framework — it's a plain class (`IdpOAuth2Client`) that talks to your identity provider over `fetch`. You call its methods from whatever framework you use, the same way you'd call any other browser API.

1. The client fetches `${issuerUrl}/.well-known/openid-configuration` (unless you pass `endpoints` yourself) to resolve `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, and `revocation_endpoint`.
2. It generates a PKCE `code_verifier` / `code_challenge` pair (S256) and a random `state`, and stashes the verifier in `sessionStorage`, keyed by `state`.
3. It opens a popup (or redirects the whole page) to `authorization_endpoint` with the appropriate query parameters.
4. The user signs in / consents with the provider **on a screen the provider itself hosts and designs** — this package never renders that screen; it only opens it (popup) or navigates to it (redirect). The provider then redirects back to your `redirect_uri` with `code` and `state`.
5. **Popup mode:** the small callback page (step 2 below) posts `{ code, state }` back to the opener window and closes itself — this page has no UI of its own either; see [What the popup actually looks like](#what-the-popup-actually-looks-like).
   **Redirect mode:** `handleRedirectCallback()` reads `code`/`state` directly off the current page's URL.
6. `state` is validated against what was saved, the matching `code_verifier` is retrieved, and `token_endpoint` is called with `grant_type=authorization_code` to exchange the code for tokens.
7. If the response includes an `id_token`, its claims are checked against [OIDC Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation): `nonce` must match the value generated in step 2 (replay protection), `aud` must include your `client_id`, `iss` must match the provider, and `exp` must be in the future. A failing check rejects with `IdTokenValidationError`. **This does not verify the id_token's JWS signature** — doing so needs the provider's JWKS (key fetching/caching, `kid` matching, algorithm allow-listing) and this package treats the direct HTTPS call to `token_endpoint` as sufficient transport trust for now. If you need signature verification too, verify it server-side, or decode it yourself with a library like [`jose`](https://www.npmjs.com/package/jose).

If the user closes the popup mid-flow, the returned promise rejects with `PopupClosedByUserError`. If the flow doesn't complete within the timeout, it rejects with `PopupTimeoutError` (default 5 minutes, configurable via `timeoutMs`).

**Where does UI come from, then?** Two places, neither of them this package: (a) the provider's own hosted sign-in/consent screen in step 4, and (b) whatever you build in your own app — the "Sign in" button, loading states, the authenticated dashboard — using this package's methods as plain function calls.

## 1. Register an OAuth2 client with your provider

Whichever IdP you use, register a client with:

- **Client type:** `public` (a browser app cannot keep a secret — this library never sends `client_secret`).
- **Grant type:** Authorization Code, with PKCE enabled/required.
- **Redirect URIs:** include the exact URL your app will use as `redirectUri`, e.g. `https://myapp.com/oauth2/callback`.

## 2. Create a callback page (popup mode only)

> Skip this section entirely if you're using `uxMode: 'redirect'` — see [Redirect mode](#redirect-mode-example) below.

In popup mode, host a small static page at the exact `redirect_uri` you registered with the provider. This page only ever runs _inside the popup window_ — it reads `code` / `state` off its own URL and posts them back to the window that opened it (your app), then closes itself.

**As a static HTML file** (works for any stack — plain HTML, PHP, a static export, etc.):

```html
<!-- served at /oauth2/callback -->
<!doctype html>
<script type="module">
    import { handleOAuth2PopupCallback } from 'oauth2-oidc-pkce-client/callback';
    handleOAuth2PopupCallback();
</script>
```

**As a framework route** — call `handleOAuth2PopupCallback()` once as soon as the route mounts. See the [framework-specific examples](#4-framework-usage) below for React, Vue, Angular, Svelte, Next.js, etc.

### What the popup actually looks like

`handleOAuth2PopupCallback()` does **not** render any UI — look at its implementation (`src/callback.ts`): it only reads `code`/`state`/`error` off the URL, calls `window.opener.postMessage(...)`, and returns. The opener window is the one that calls `popup.close()`, and it does so the instant it receives that message — see `waitForPopupMessage()` in `src/utils/popup.util.ts`.

In practice this means the popup shows **whatever is already on the page at that URL** for a single frame or two — usually a blank white background — and then disappears. There's no time for a "Signing you in…" message to be read, so:

- The framework examples below render `null` / an empty template for this route on purpose — that's not a placeholder you need to fill in, it's the correct, final implementation.
- If you still want _some_ visual (e.g. to avoid a jarring flash of unstyled white), keep it extremely minimal — a background color matching your app, or a simple centered spinner with no text — since it will rarely, if ever, actually be seen.
- Don't put login logic, redirects, or anything stateful on this page. Its only job is calling `handleOAuth2PopupCallback()` once.

## 3. Initialize the client

```ts
import { IdpOAuth2Client } from 'oauth2-oidc-pkce-client';

export const idp = new IdpOAuth2Client({
    clientId: 'your-client-id',
    issuerUrl: 'https://idp.example.com',
    redirectUri: 'https://myapp.com/oauth2/callback',
    scope: 'openid profile email',
    uxMode: 'popup', // or 'redirect' — default is 'popup'
});
```

Create this instance once (e.g. in a module you import elsewhere, or a singleton service) rather than re-instantiating it on every render/component — the class internally memoizes the discovery-document fetch per instance.

## 4. Framework usage

The examples below all use the same `idp` instance from step 3. There is no framework-specific package or adapter to install — every example below imports directly from `oauth2-oidc-pkce-client`.

### Vanilla JavaScript / TypeScript

```html
<button id="login">Sign in</button>

<script type="module">
    import { IdpOAuth2Client } from 'oauth2-oidc-pkce-client';

    const idp = new IdpOAuth2Client({
        clientId: 'your-client-id',
        issuerUrl: 'https://idp.example.com',
        redirectUri: 'https://myapp.com/oauth2/callback',
        scope: 'openid profile email',
    });

    document.getElementById('login').addEventListener('click', async () => {
        try {
            const tokens = await idp.loginWithPopup();
            const user = await idp.getUserInfo(tokens.access_token);
            console.log('Signed in as', user.email);
        } catch (err) {
            console.error('Login failed', err);
        }
    });
</script>
```

### React

```tsx
// idp.ts — create the client once, outside any component
import { IdpOAuth2Client } from 'oauth2-oidc-pkce-client';

export const idp = new IdpOAuth2Client({
    clientId: 'your-client-id',
    issuerUrl: 'https://idp.example.com',
    redirectUri: `${window.location.origin}/oauth2/callback`,
    scope: 'openid profile email',
});
```

```tsx
// LoginButton.tsx
import { useState } from 'react';
import { idp } from './idp';

export function LoginButton() {
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async () => {
        try {
            const tokens = await idp.loginWithPopup();
            const user = await idp.getUserInfo(tokens.access_token);
            console.log('Signed in as', user.email);
        } catch (err) {
            setError((err as Error).message);
        }
    };

    return (
        <>
            <button onClick={handleLogin}>Sign in</button>
            {error && <p role="alert">{error}</p>}
        </>
    );
}
```

```tsx
// routes/oauth2/callback.tsx — the popup-only callback page/route
import { useEffect } from 'react';
import { handleOAuth2PopupCallback } from 'oauth2-oidc-pkce-client/callback';

export function OAuth2CallbackPage() {
    useEffect(() => {
        handleOAuth2PopupCallback();
    }, []);

    // `handleOAuth2PopupCallback()` closes this popup itself, almost
    // immediately — there's nothing for the user to read here, so this
    // component intentionally renders nothing. See "What the popup actually
    // looks like" below if you want to add a spinner anyway.
    return null;
}
```

### Vue 3

```ts
// composables/useIdp.ts
import { IdpOAuth2Client } from 'oauth2-oidc-pkce-client';

export const idp = new IdpOAuth2Client({
    clientId: 'your-client-id',
    issuerUrl: 'https://idp.example.com',
    redirectUri: `${window.location.origin}/oauth2/callback`,
    scope: 'openid profile email',
});
```

```vue
<!-- LoginButton.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { idp } from '../composables/useIdp';

const error = ref<string | null>(null);

async function handleLogin() {
    try {
        const tokens = await idp.loginWithPopup();
        const user = await idp.getUserInfo(tokens.access_token);
        console.log('Signed in as', user.email);
    } catch (err) {
        error.value = (err as Error).message;
    }
}
</script>

<template>
    <button @click="handleLogin">Sign in</button>
    <p v-if="error" role="alert">{{ error }}</p>
</template>
```

```vue
<!-- views/OAuth2Callback.vue — the popup-only callback route -->
<script setup lang="ts">
import { onMounted } from 'vue';
import { handleOAuth2PopupCallback } from 'oauth2-oidc-pkce-client/callback';

onMounted(() => {
    handleOAuth2PopupCallback();
});
</script>

<template>
    <!-- Intentionally empty: the popup closes itself almost immediately. -->
</template>
```

### Angular

```ts
// idp.service.ts
import { Injectable } from '@angular/core';
import { IdpOAuth2Client } from 'oauth2-oidc-pkce-client';

@Injectable({ providedIn: 'root' })
export class IdpService {
    readonly client = new IdpOAuth2Client({
        clientId: 'your-client-id',
        issuerUrl: 'https://idp.example.com',
        redirectUri: `${window.location.origin}/oauth2/callback`,
        scope: 'openid profile email',
    });
}
```

```ts
// login-button.component.ts
import { Component } from '@angular/core';
import { IdpService } from '../idp.service';

@Component({
    selector: 'app-login-button',
    standalone: true,
    template: `
        <button (click)="handleLogin()">Sign in</button>
        <p *ngIf="error" role="alert">{{ error }}</p>
    `,
})
export class LoginButtonComponent {
    error: string | null = null;

    constructor(private readonly idpService: IdpService) {}

    async handleLogin() {
        try {
            const tokens = await this.idpService.client.loginWithPopup();
            const user = await this.idpService.client.getUserInfo(tokens.access_token);
            console.log('Signed in as', user.email);
        } catch (err) {
            this.error = (err as Error).message;
        }
    }
}
```

```ts
// oauth2-callback.component.ts — the popup-only callback route
import { Component, OnInit } from '@angular/core';
import { handleOAuth2PopupCallback } from 'oauth2-oidc-pkce-client/callback';

@Component({
    selector: 'app-oauth2-callback',
    standalone: true,
    // Intentionally empty template: the popup closes itself almost
    // immediately, so there's nothing meaningful for the user to see.
    template: ``,
})
export class OAuth2CallbackComponent implements OnInit {
    ngOnInit() {
        handleOAuth2PopupCallback();
    }
}
```

### Svelte / SvelteKit

```ts
// lib/idp.ts
import { IdpOAuth2Client } from 'oauth2-oidc-pkce-client';

export const idp = new IdpOAuth2Client({
    clientId: 'your-client-id',
    issuerUrl: 'https://idp.example.com',
    redirectUri: `${window.location.origin}/oauth2/callback`,
    scope: 'openid profile email',
});
```

```svelte
<!-- LoginButton.svelte -->
<script lang="ts">
  import { idp } from '$lib/idp';

  let error: string | null = null;

  async function handleLogin() {
    try {
      const tokens = await idp.loginWithPopup();
      const user = await idp.getUserInfo(tokens.access_token);
      console.log('Signed in as', user.email);
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<button on:click={handleLogin}>Sign in</button>
{#if error}<p role="alert">{error}</p>{/if}
```

```svelte
<!-- routes/oauth2/callback/+page.svelte — the popup-only callback route -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { handleOAuth2PopupCallback } from 'oauth2-oidc-pkce-client/callback';

  onMount(() => {
    handleOAuth2PopupCallback();
  });
</script>

<!-- Intentionally empty: the popup closes itself almost immediately. -->
```

> SvelteKit note: since `handleOAuth2PopupCallback()` reads `window.location`, make sure this page/route isn't server-rendered (add `export const ssr = false;` in a co-located `+page.ts` if needed).

### Solid.js

```tsx
// idp.ts
import { IdpOAuth2Client } from 'oauth2-oidc-pkce-client';

export const idp = new IdpOAuth2Client({
    clientId: 'your-client-id',
    issuerUrl: 'https://idp.example.com',
    redirectUri: `${window.location.origin}/oauth2/callback`,
    scope: 'openid profile email',
});
```

```tsx
// LoginButton.tsx
import { createSignal } from 'solid-js';
import { idp } from './idp';

export function LoginButton() {
    const [error, setError] = createSignal<string | null>(null);

    const handleLogin = async () => {
        try {
            const tokens = await idp.loginWithPopup();
            const user = await idp.getUserInfo(tokens.access_token);
            console.log('Signed in as', user.email);
        } catch (err) {
            setError((err as Error).message);
        }
    };

    return (
        <>
            <button onClick={handleLogin}>Sign in</button>
            {error() && <p role="alert">{error()}</p>}
        </>
    );
}
```

```tsx
// routes/oauth2/callback.tsx — the popup-only callback route
import { onMount } from 'solid-js';
import { handleOAuth2PopupCallback } from 'oauth2-oidc-pkce-client/callback';

export function OAuth2CallbackPage() {
    onMount(() => {
        handleOAuth2PopupCallback();
    });

    // Intentionally empty: the popup closes itself almost immediately.
    return null;
}
```

### Next.js (App Router)

Because this library relies on browser-only APIs (`window`, `sessionStorage`, popups), any component that calls it must be a **Client Component**.

```tsx
// app/oauth2/callback/page.tsx
'use client';

import { useEffect } from 'react';
import { handleOAuth2PopupCallback } from 'oauth2-oidc-pkce-client/callback';

export default function OAuth2CallbackPage() {
    useEffect(() => {
        handleOAuth2PopupCallback();
    }, []);

    // Intentionally empty: the popup closes itself almost immediately.
    return null;
}
```

```tsx
// components/LoginButton.tsx
'use client';

import { IdpOAuth2Client } from 'oauth2-oidc-pkce-client';

const idp = new IdpOAuth2Client({
    clientId: process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID!,
    issuerUrl: process.env.NEXT_PUBLIC_OAUTH_ISSUER_URL!,
    redirectUri: `${window.location.origin}/oauth2/callback`,
    scope: 'openid profile email',
});

export function LoginButton() {
    return (
        <button
            onClick={async () => {
                const tokens = await idp.loginWithPopup();
                const user = await idp.getUserInfo(tokens.access_token);
                console.log(user.email);
            }}
        >
            Sign in
        </button>
    );
}
```

Use `NEXT_PUBLIC_`-prefixed environment variables since these values are needed in the browser bundle.

### Nuxt 3

Use redirect mode here to sidestep SSR/hydration concerns with popups, or gate popup usage behind `<ClientOnly>`.

```ts
// composables/useIdp.ts
import { IdpOAuth2Client } from 'oauth2-oidc-pkce-client';

export function useIdp() {
    const config = useRuntimeConfig();
    return new IdpOAuth2Client({
        clientId: config.public.oauthClientId,
        issuerUrl: config.public.oauthIssuerUrl,
        redirectUri: `${window.location.origin}/oauth2/callback`,
        scope: 'openid profile email',
        uxMode: 'redirect',
    });
}
```

```vue
<!-- pages/oauth2/callback.vue -->
<script setup lang="ts">
import { useIdp } from '~/composables/useIdp';

const idp = useIdp();

onMounted(async () => {
    const tokens = await idp.handleRedirectCallback();
    if (!tokens) return;
    const user = await idp.getUserInfo(tokens.access_token);
    console.log(user.email);
    await navigateTo('/dashboard');
});
</script>

<template>
    <p>Signing you in…</p>
</template>
```

## Redirect mode (example)

Redirect mode navigates the whole page to the provider and back — no popup, no `postMessage`, and **no dedicated callback page/component is required beyond calling `handleRedirectCallback()`** wherever your `redirectUri` route already lives.

```ts
const idp = new IdpOAuth2Client({
    clientId: 'your-client-id',
    issuerUrl: 'https://idp.example.com',
    redirectUri: 'https://myapp.com/oauth2/callback',
    scope: 'openid profile email',
    uxMode: 'redirect',
});

// Login button — navigates the whole page away; this promise never resolves.
async function onLoginButtonClick() {
    await idp.login(); // equivalent to idp.loginWithRedirect()
}

// In the /oauth2/callback route (React useEffect, Vue onMounted, Angular
// ngOnInit, Svelte onMount, etc.) — call once, unconditionally, on mount:
async function onCallbackRouteMount() {
    const tokens = await idp.handleRedirectCallback();
    if (!tokens) return; // not an OAuth2 callback (e.g. a direct page visit)

    const user = await idp.getUserInfo(tokens.access_token);
    console.log(user.email);
    // navigate the user to your app's authenticated area
}
```

`handleRedirectCallback()` strips the callback query params from the URL after reading them (via `history.replaceState`), so a page refresh can't resubmit the same authorization code.

**Important:** `loginWithPopup()` (and `login()` when `uxMode` is `'popup'`, the default) must be invoked directly inside a real user-gesture handler (an `onClick`/`click` callback) — not inside a `useEffect`, `then()` chain, `setTimeout`, or anything async before the call — or the browser will block the popup as unsolicited.

**If your app offers both modes** (e.g. popup on desktop, redirect as a fallback), use two separate `IdpOAuth2Client` instances with two different `redirectUri` values — one pointing at the popup's callback page, one pointing back at wherever `handleRedirectCallback()` is actually called. Pointing both modes at the same `redirectUri` means redirect mode lands on a page that only knows how to `postMessage` to a popup opener that doesn't exist, and just hangs.

## Providers without discovery support

Some providers don't expose `.well-known/openid-configuration` under a single base URL, or split their endpoints across separate subdomains. Pass `endpoints` directly to skip discovery entirely:

```ts
const idp = new IdpOAuth2Client({
    clientId: 'your-client-id',
    issuerUrl: 'https://provider.example.com', // still required for reference; unused for URL building once endpoints is set
    redirectUri: 'https://myapp.com/oauth2/callback',
    scope: 'openid profile email',
    endpoints: {
        issuer: 'https://provider.example.com',
        authorization_endpoint: 'https://provider.example.com/oauth2/v2/auth',
        token_endpoint: 'https://token.provider.example.com/token',
        userinfo_endpoint: 'https://provider.example.com/v1/userinfo',
        revocation_endpoint: 'https://token.provider.example.com/revoke',
    },
});
```

When `endpoints` is supplied, the client never calls discovery — those URLs are used as-is.

## Refreshing tokens

```ts
const fresh = await idp.refreshAccessToken(tokens.refresh_token);
```

## Logout / token revocation

```ts
await idp.revokeToken(tokens.refresh_token, 'refresh_token');
// then clear whatever you stored locally and route the user to a signed-out state
```

## Token storage guidance

This package intentionally does **not** store tokens for you — you decide where they live (in-memory app state, a store, an HttpOnly cookie set by your backend, etc.). Since this runs in a public/browser client:

- Prefer keeping `refresh_token` out of any storage readable by JavaScript (e.g. `localStorage`) unless your app has strong XSS mitigations in place (strict CSP, no unsanitized HTML rendering, trusted-types, etc.).
- In-memory storage (a module-level variable, a store like Zustand/Pinia/a signal) is the simplest safe default for access tokens; treat any XSS as a full one, since anything running JS can read what JS can read.
- If you control the backend too, consider proxying the token exchange or storing tokens server-side in an HttpOnly cookie instead of handling them purely client-side.

## Error handling

All methods reject with typed errors so you can branch on `err.name` or `instanceof`:

| Error                    | When it's thrown                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `PopupBlockedError`      | `window.open()` returned `null` — the browser blocked the popup.                                                                                |
| `PopupClosedByUserError` | The user closed the popup before finishing sign-in.                                                                                             |
| `PopupTimeoutError`      | The flow didn't complete within `timeoutMs` (default 5 minutes).                                                                                |
| `IdpOAuth2ApiError`      | The provider returned an OAuth2 error (invalid_grant, invalid_state, etc.) — inspect `err.errorBody.error` / `err.errorBody.error_description`. |
| `IdTokenValidationError` | The response included an `id_token` whose `nonce`, `aud`, `iss`, or `exp` claim failed validation — see [How it works, step 7](#how-it-works).  |

```ts
import { PopupBlockedError, PopupClosedByUserError, PopupTimeoutError, IdpOAuth2ApiError, IdTokenValidationError } from 'oauth2-oidc-pkce-client';

try {
    const tokens = await idp.loginWithPopup();
} catch (err) {
    if (err instanceof PopupBlockedError) {
        // prompt the user to retry via a direct click
    } else if (err instanceof PopupClosedByUserError) {
        // user backed out — usually fine to just do nothing
    } else if (err instanceof PopupTimeoutError) {
        // flow took too long — offer a retry
    } else if (err instanceof IdTokenValidationError) {
        // id_token claims didn't check out — treat like a failed sign-in, maybe log for investigation
    } else if (err instanceof IdpOAuth2ApiError) {
        console.error(err.errorBody.error, err.errorBody.error_description);
    } else {
        throw err;
    }
}
```

## API reference

### `new IdpOAuth2Client(config)`

| Option                       | Type                    | Required | Description                                                                                  |
| ---------------------------- | ----------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `clientId`                   | `string`                | yes      | OAuth2 `client_id` registered with your provider.                                            |
| `issuerUrl`                  | `string`                | yes      | Provider's issuer URL, used for discovery unless `endpoints` is set.                         |
| `redirectUri`                | `string`                | yes      | Must be an allow-listed redirect URI on your app's origin.                                   |
| `scope`                      | `string`                | yes      | Space-separated scopes, e.g. `"openid profile email"`.                                       |
| `endpoints`                  | `object`                | –        | Static endpoint map to bypass discovery — see [above](#providers-without-discovery-support). |
| `uxMode`                     | `'popup' \| 'redirect'` | –        | Defaults to `'popup'`.                                                                       |
| `popupWidth` / `popupHeight` | `number`                | –        | Popup dimensions. Defaults to 480×640.                                                       |
| `timeoutMs`                  | `number`                | –        | Popup flow timeout. Defaults to 5 minutes.                                                   |

### Methods

| Method                               | Returns                          | Description                                                                                         |
| ------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `login(options?)`                    | `Promise<TokenResponse \| void>` | Starts sign-in using the configured `uxMode`.                                                       |
| `loginWithPopup(options?)`           | `Promise<TokenResponse>`         | Opens a popup; resolves with tokens. Must be called from a click handler.                           |
| `loginWithRedirect(options?)`        | `Promise<void>`                  | Navigates the whole page away; promise never resolves.                                              |
| `handleRedirectCallback()`           | `Promise<TokenResponse \| null>` | Call on mount at `redirectUri` in redirect mode. Returns `null` if this page load isn't a callback. |
| `getUserInfo(accessToken)`           | `Promise<UserInfo>`              | Calls the provider's `userinfo_endpoint`.                                                           |
| `refreshAccessToken(refreshToken)`   | `Promise<TokenResponse>`         | Exchanges a refresh token for a new token response.                                                 |
| `revokeToken(token, tokenTypeHint?)` | `Promise<void>`                  | Calls `revocation_endpoint` (RFC 7009).                                                             |

`options` for `login` / `loginWithPopup` / `loginWithRedirect` accepts `{ prompt?: string }` (forwarded as the `prompt` query parameter, e.g. `'login'` or `'consent'`).

### `handleOAuth2PopupCallback()`

Exported from `oauth2-oidc-pkce-client/callback`. Call it unconditionally as soon as the popup's callback page/route loads — it reads `code`/`state`/`error` off the current URL, posts them to the opener via `postMessage`, and closes the popup. No return value; nothing else on that page needs to run.

### `decodeIdTokenPayload(idToken)`

Decodes an `id_token`'s claims (`{ sub, iss, aud, exp, iat, nonce, ... }`) without verifying its signature — the same decoder this package uses internally to validate `nonce`/`aud`/`iss`/`exp` after sign-in. Useful if you want to read `sub`/`email`/`name` etc. straight off `tokens.id_token` without an extra `getUserInfo()` round trip:

```ts
import { decodeIdTokenPayload } from 'oauth2-oidc-pkce-client';

const tokens = await idp.loginWithPopup();
if (tokens.id_token) {
    const claims = decodeIdTokenPayload(tokens.id_token);
    console.log(claims.sub, claims.email);
}
```

By the time you have `tokens`, this package has already validated these same claims (see [How it works, step 7](#how-it-works)) — this is just a convenience accessor, not a second validation pass.

## TypeScript

Written in TypeScript; type declarations are bundled, no `@types/*` package needed. All framework examples above are shown in TypeScript, but everything works identically from plain JavaScript — just drop the type annotations.

Key exported types:

```ts
import type { IIdpOAuth2ClientConfig, IIdpTokenResponse, IIdpUserInfo, IIdpOAuth2Error, IIdTokenClaims } from 'oauth2-oidc-pkce-client';
```

## FAQ

**Does this work with [my framework]?**
Yes — it has zero framework dependencies. If your stack can run a `fetch` call and open a popup/redirect (i.e., it runs in a browser), it works: React, Vue, Angular, Svelte, SolidJS, Qwik, Lit, htmx-based apps, or plain script tags.

**Can I use this in a server-rendered page?**
The client itself (`IdpOAuth2Client`, `handleOAuth2PopupCallback`) touches `window`, so it must run in the browser. Guard any SSR framework's server render path accordingly (Client Components in Next.js, `<ClientOnly>`/`process.client` in Nuxt, `ssr = false` in SvelteKit, etc.) — see the framework sections above.

**Why does my popup get blocked?**
Browsers only allow `window.open()` synchronously inside a genuine user gesture. As of this version, the popup is opened as `about:blank` immediately (synchronously) and only navigated to the provider's URL once PKCE setup finishes — this specifically fixes Safari, which is much stricter than Chrome/Firefox about tolerating any `await` before `window.open()`. Still make sure `loginWithPopup()` / `login()` is the first thing your click handler does — don't call it after an earlier `await` or inside a `setTimeout`, since that delay is outside this library's control.

**My popup got blocked once, I allowed it, and then it just hangs on "Completing sign-in…" forever.**
This was the Safari failure mode fixed above (upgrade to pick it up). A Safari popup that was blocked and then manually allowed via the address-bar icon opens full-size and — going forward — should be a properly-connected popup like any other, but avoiding the block in the first place is more reliable than depending on that recovery path. If you still see this on an old version: it happens because that manually-allowed popup doesn't reliably keep a working `window.opener`, so it can never `postMessage` back, and it never closes itself.

**Does this store my tokens?**
No — see [Token storage guidance](#token-storage-guidance). You own that decision.

**Does this support the implicit flow?**
No, intentionally — the implicit flow is deprecated by current OAuth2 best practices. This library only implements Authorization Code + PKCE.

## Contributing

Issues and PRs welcome. To develop locally:

```bash
npm install
npm run dev         # tsup --watch — rebuilds dist/ on save
npm run typecheck   # tsc --noEmit
npm run test        # vitest run — unit + integration tests (jsdom)
npm run test:watch  # vitest — watch mode while developing
npm run build       # tsup — full clean build (ESM + CJS + .d.ts + source maps)
```

`npm run prepublishOnly` runs `typecheck`, `test`, then `build` automatically before every `npm publish`, so a type error, a failing test, or a build failure can't ship to npm.

### Built with

<p align="center">
  <a href="https://skillicons.dev">
    <img src="https://skillicons.dev/icons?i=ts,nodejs,npm,vitest,git,github" alt="TypeScript, Node.js, npm, Vitest, Git, GitHub" />
  </a>
</p>

## License

MIT — see [LICENSE](./LICENSE).
