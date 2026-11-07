import path from 'path';
import os from 'os';

/** Loopback hosts: localhost, ::1, [::1], and any 127.x.y.z dotted quad (anchored match only). */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  return m.slice(1).every((octet) => Number(octet) <= 255);
}

export function assertLoopbackBind(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new Error(
      `Refusing to bind to non-loopback HOST "${host}": the gateway has no authentication yet. ` +
        `Unset HOST or use 127.0.0.1.`
    );
  }
}

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

/**
 * Parse a comma-separated ALLOWED_ORIGINS value. Blank/undefined yields the dev defaults.
 * Wildcards and anything that is not a bare http(s) origin are rejected (fail fast).
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [...DEFAULT_ALLOWED_ORIGINS];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const bad = (why: string) =>
        new Error(`Invalid ALLOWED_ORIGINS entry "${entry}": ${why}`);
      if (entry === '*' || entry.includes('*')) throw bad('wildcards are not allowed');
      let url: URL;
      try {
        url = new URL(entry);
      } catch {
        throw bad('not a valid origin');
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw bad('must be an http or https origin');
      }
      if (url.username || url.password) throw bad('credentials are not allowed');
      if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
        throw bad('must not contain a path, query or fragment');
      }
      return entry.replace(/\/+$/, '');
    });
}

const rawHost = process.env.HOST?.trim();

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 8088,
  HOST: rawHost ? rawHost : '127.0.0.1',
  ALLOWED_ORIGINS: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  MAX_PAYLOAD_BYTES: 1048576,
  HEARTBEAT_MS: 30000,
  WS_PATH: '/ws',
  DEFAULT_SHELL: process.env.SHELL || '/bin/bash',
  SSH_KEY_PATHS: [
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
  ],
  SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
};
