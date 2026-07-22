import { describe, it, expect } from 'vitest';
import { toBase64Url, fromBase64Url, randomBase64Url } from './base64url.util';

describe('toBase64Url / fromBase64Url', () => {
    it('round-trips arbitrary byte sequences', () => {
        const cases: number[][] = [
            [],
            [0],
            [255],
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            Array.from({ length: 32 }, (_, i) => (i * 7) % 256),
        ];
        for (const values of cases) {
            const bytes = new Uint8Array(values);
            const decoded = fromBase64Url(toBase64Url(bytes));
            expect(Array.from(decoded)).toEqual(values);
        }
    });

    it('produces URL-safe output with no padding', () => {
        // All-0xFF bytes reliably produce '+', '/', and '=' padding under plain base64.
        const bytes = new Uint8Array(16).fill(255);
        const encoded = toBase64Url(bytes);
        expect(encoded).not.toMatch(/[+/=]/);
        expect(encoded).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('decodes a known vector the same way atob would for standard base64', () => {
        // "hello" -> base64 "aGVsbG8=" -> base64url "aGVsbG8"
        expect(Array.from(fromBase64Url('aGVsbG8'))).toEqual(Array.from(new TextEncoder().encode('hello')));
    });
});

describe('randomBase64Url', () => {
    it('returns different values across calls (astronomically unlikely to collide)', () => {
        const a = randomBase64Url(32);
        const b = randomBase64Url(32);
        expect(a).not.toBe(b);
    });

    it('encodes the requested number of bytes with no padding characters', () => {
        // 32 random bytes -> 43 base64url chars (ceil(32*8/6) with no padding)
        expect(randomBase64Url(32)).toHaveLength(43);
        expect(randomBase64Url(16)).toHaveLength(22);
    });
});
