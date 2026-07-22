import { describe, it, expect } from 'vitest';
import { generatePkcePair } from './pkce.util';
import { toBase64Url } from './base64url.util';

describe('generatePkcePair', () => {
    it('generates a code_verifier within the RFC 7636 length bounds (43-128 chars) using only unreserved chars', async () => {
        const { codeVerifier } = await generatePkcePair();
        expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
        expect(codeVerifier.length).toBeLessThanOrEqual(128);
        // RFC 7636 §4.1 unreserved charset is [A-Za-z0-9-._~]; base64url output
        // (as produced here) is a subset of that: [A-Za-z0-9-_].
        expect(codeVerifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('derives code_challenge as BASE64URL(SHA256(code_verifier))', async () => {
        const { codeVerifier, codeChallenge } = await generatePkcePair();

        const expectedDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
        const expectedChallenge = toBase64Url(new Uint8Array(expectedDigest));

        expect(codeChallenge).toBe(expectedChallenge);
    });

    it('generates a fresh, non-repeating pair on every call', async () => {
        const first = await generatePkcePair();
        const second = await generatePkcePair();
        expect(first.codeVerifier).not.toBe(second.codeVerifier);
        expect(first.codeChallenge).not.toBe(second.codeChallenge);
    });
});
