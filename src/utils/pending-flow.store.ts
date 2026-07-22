import { PENDING_FLOW_STORAGE_PREFIX } from '../constants';

interface IPendingFlow {
    codeVerifier: string;
    nonce: string;
    createdAt: number;
}

function storageKey(state: string): string {
    return `${PENDING_FLOW_STORAGE_PREFIX}${state}`;
}

export function savePendingFlow(state: string, codeVerifier: string, nonce: string): void {
    const pendingFlow: IPendingFlow = { codeVerifier, nonce, createdAt: Date.now() };
    sessionStorage.setItem(storageKey(state), JSON.stringify(pendingFlow));
}

/** Reads and immediately deletes the entry — a state value is single-use. */
export function consumePendingFlow(state: string): IPendingFlow | null {
    const key = storageKey(state);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    try {
        return JSON.parse(raw) as IPendingFlow;
    } catch {
        return null;
    }
}
