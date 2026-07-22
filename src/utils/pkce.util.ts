import { CODE_VERIFIER_BYTE_LENGTH } from '../constants';
import { randomBase64Url, toBase64Url } from './base64url.util';

export interface IPkcePair {
    codeVerifier: string;
    codeChallenge: string;
}

/**
 * code_challenge = BASE64URL(SHA256(code_verifier)) — must match
 * `verifyCodeChallenge` on the backend (06-backend-oauth2.md, ECodeChallengeMethod.S256).
 */
export async function generatePkcePair(): Promise<IPkcePair> {
    const codeVerifier = randomBase64Url(CODE_VERIFIER_BYTE_LENGTH);
    const verifierBytes = new TextEncoder().encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', verifierBytes);
    const codeChallenge = toBase64Url(new Uint8Array(digest));
    return { codeVerifier, codeChallenge };
}
