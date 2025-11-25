import http from 'http';
import type { AddressInfo } from 'net';

interface ResponseDefinition {
  status: number;
  body?: any;
  headers?: Record<string, string>;
}

async function startServer(responses: ResponseDefinition[]) {
  let requestCount = 0;
  const server = http.createServer((_req, res) => {
    const index = requestCount < responses.length ? requestCount : responses.length - 1;
    const response = responses[index];
    requestCount += 1;

    const headers = {
      'content-type': 'application/json',
      ...(response.headers || {}),
    };
    res.writeHead(response.status, headers);
    res.end(JSON.stringify(response.body ?? {}));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    getRequestCount: () => requestCount,
    close: async () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
}

describe('httpClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.HTTP_CLIENT_TIMEOUT_MS = '2000';
    process.env.HTTP_CLIENT_RETRY_DELAY_MS = '10';
    process.env.HTTP_CLIENT_MAX_RETRIES = '2';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('retries transient failures and succeeds on subsequent attempt', async () => {
    const server = await startServer([
      { status: 500, body: { error: 'temporary' } },
      { status: 200, body: { success: true } },
    ]);
    const httpClient = (await import('../httpClient')).default;

    try {
      const response = await httpClient.get(`${server.url}/retry`);
      expect(response.data).toEqual({ success: true });
      expect(server.getRequestCount()).toBe(2);
    } finally {
      await server.close();
    }
  });

  it('honors retry:false and does not retry failed requests', async () => {
    const server = await startServer([
      { status: 500, body: { error: 'temporary' } },
    ]);
    const httpClient = (await import('../httpClient')).default;

    try {
      await expect(httpClient.get(`${server.url}/no-retry`, { retry: false })).rejects.toThrow();
      expect(server.getRequestCount()).toBe(1);
    } finally {
      await server.close();
    }
  });
});
