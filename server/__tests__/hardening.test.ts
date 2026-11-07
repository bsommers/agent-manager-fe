import { describe, it, expect, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';

vi.mock('../src/services/TmuxDiscovery.js', () => ({
  discoverTmuxSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/TmuxDriver.js', () => ({
  TmuxDriver: vi.fn().mockImplementation(() => ({
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
  })),
}));

import { bootstrap } from '../src/index.js';
import { CONFIG, isLoopbackHost, assertLoopbackBind } from '../src/config.js';

type Handle = Awaited<ReturnType<typeof bootstrap>>;
const handles: Handle[] = [];

async function start(host = '127.0.0.1', options = {}): Promise<Handle> {
  const h = await bootstrap(0, host, options);
  handles.push(h);
  return h;
}

afterEach(async () => {
  while (handles.length) {
    const h = handles.pop()!;
    h.wss.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

describe('loopback bind (GW-01)', () => {
  it('CONFIG.HOST defaults to 127.0.0.1 and PORT to 8088', () => {
    // Test env does not set HOST/PORT overrides.
    if (!process.env.HOST?.trim()) expect(CONFIG.HOST).toBe('127.0.0.1');
    if (!process.env.PORT) expect(CONFIG.PORT).toBe(8088);
  });

  it.each(['localhost', '::1', '[::1]', '127.0.0.1', '127.1.2.3'])(
    'isLoopbackHost accepts %s',
    (h) => {
      expect(isLoopbackHost(h)).toBe(true);
    }
  );

  it.each([
    '0.0.0.0',
    '::',
    '',
    '192.168.1.5',
    '10.0.0.1',
    'example.com',
    '127.0.0.1.evil.example',
    '1270.0.0.1',
    '127.0.0.256',
  ])('isLoopbackHost rejects %j', (h) => {
    expect(isLoopbackHost(h)).toBe(false);
  });

  it('assertLoopbackBind throws an actionable error for non-loopback hosts', () => {
    expect(() => assertLoopbackBind('0.0.0.0')).toThrowError(/HOST/);
    expect(() => assertLoopbackBind('0.0.0.0')).toThrowError(/no authentication/i);
    expect(() => assertLoopbackBind('0.0.0.0')).toThrowError(/unset HOST or use 127\.0\.0\.1/i);
    expect(() => assertLoopbackBind('127.0.0.1')).not.toThrow();
  });

  it('bootstrap listens on 127.0.0.1', async () => {
    const { server } = await start('127.0.0.1');
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    expect(addr.port).toBeGreaterThan(0);
  });

  it('bootstrap rejects a non-loopback host and leaves nothing listening', async () => {
    await expect(bootstrap(0, '0.0.0.0')).rejects.toThrow(/HOST/);
  });
});
