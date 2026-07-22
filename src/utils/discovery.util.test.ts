import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchDiscoveryDocument } from './discovery.util';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('fetchDiscoveryDocument', () => {
    it('fetches the well-known path relative to the issuer and returns the parsed document', async () => {
        const document = {
            issuer: 'https://idp.example',
            authorization_endpoint: 'https://idp.example/authorize',
            token_endpoint: 'https://idp.example/token',
        };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(document), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchDiscoveryDocument('https://idp.example');

        expect(fetchMock).toHaveBeenCalledWith('https://idp.example/.well-known/openid-configuration');
        expect(result).toEqual(document);
    });

    it('throws with the URL and status when the discovery request fails', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchDiscoveryDocument('https://idp.example')).rejects.toThrow(/404/);
    });
});
