import { describe, it, expect, beforeEach } from 'vitest';
import { savePendingFlow, consumePendingFlow } from './pending-flow.store';

beforeEach(() => {
    sessionStorage.clear();
});

describe('savePendingFlow / consumePendingFlow', () => {
    it('round-trips codeVerifier and nonce for a given state', () => {
        savePendingFlow('state-1', 'verifier-1', 'nonce-1');
        const flow = consumePendingFlow('state-1');
        expect(flow).not.toBeNull();
        expect(flow?.codeVerifier).toBe('verifier-1');
        expect(flow?.nonce).toBe('nonce-1');
        expect(typeof flow?.createdAt).toBe('number');
    });

    it('is single-use: a second consume for the same state returns null', () => {
        savePendingFlow('state-1', 'verifier-1', 'nonce-1');
        expect(consumePendingFlow('state-1')).not.toBeNull();
        expect(consumePendingFlow('state-1')).toBeNull();
    });

    it('returns null for a state that was never saved', () => {
        expect(consumePendingFlow('never-saved')).toBeNull();
    });

    it('keeps concurrent flows for different states independent', () => {
        savePendingFlow('state-a', 'verifier-a', 'nonce-a');
        savePendingFlow('state-b', 'verifier-b', 'nonce-b');

        const a = consumePendingFlow('state-a');
        expect(a?.codeVerifier).toBe('verifier-a');
        // state-b must still be there — consuming state-a shouldn't touch it.
        const b = consumePendingFlow('state-b');
        expect(b?.codeVerifier).toBe('verifier-b');
    });

    it('returns null instead of throwing when the stored entry is corrupted JSON', () => {
        sessionStorage.setItem('idp_oauth2_pending:state-1', 'not-json{');
        expect(consumePendingFlow('state-1')).toBeNull();
    });
});
