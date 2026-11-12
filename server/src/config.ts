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
      `Refusing to bind to non-loopback HOST "${host}": the gateway has no authentication unless ` +
        `AGENT_MANAGER_TOKEN is set. Set AGENT_MANAGER_TOKEN to allow remote access, or unset HOST or use 127.0.0.1.`
    );
  }
}

export const MIN_TOKEN_LENGTH = 24;
export const MAX_TOKEN_LENGTH = 512;

const TOKEN_CHARS = /^[\x21-\x7e]+$/;

/**
 * Throws unless the token is MIN..MAX_TOKEN_LENGTH printable ASCII characters with no space or
 * control character. The message states the rule and the variable name; it never includes the
 * value or its length.
 */
export function validateAuthToken(token: string): void {
  const ok =
    typeof token === 'string' &&
    token.length >= MIN_TOKEN_LENGTH &&
    token.length <= MAX_TOKEN_LENGTH &&
    TOKEN_CHARS.test(token);
  if (!ok) {
    throw new Error(
      `Invalid AGENT_MANAGER_TOKEN: it must be ${MIN_TOKEN_LENGTH} to ${MAX_TOKEN_LENGTH} printable ASCII ` +
        `characters with no space or control character (a trailing newline counts). ` +
        `Generate one with: openssl rand -base64 32`
    );
  }
}

/**
 * The configured token, or undefined for zero-config local use (D-12). Unset or empty means no
 * auth; anything else must validate, with no trimming: a secret is never silently mutated and a
 * trailing newline from an .env file is reported. The token enters the process only through here.
 */
export function resolveAuthToken(env: Record<string, string | undefined>): string | undefined {
  const value = env.AGENT_MANAGER_TOKEN;
  if (value === undefined || value === '') return undefined;
  validateAuthToken(value);
  return value;
}

/** A non-loopback bind needs a token (D-10); a loopback bind never does. One refusal message. */
export function assertBindPolicy(host: string, token: string | undefined): void {
  if (token !== undefined) return;
  assertLoopbackBind(host);
}

/** AGENT_MANAGER_TRUST_PROXY: 1/true or 0/false/unset; anything else fails fast. */
export function parseTrustProxy(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  throw new Error('Invalid AGENT_MANAGER_TRUST_PROXY: use 1/true or 0/false (default off).');
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
  /** Honour X-Forwarded-For from a loopback proxy when keying the auth throttle (default off). */
  TRUST_PROXY: parseTrustProxy(process.env.AGENT_MANAGER_TRUST_PROXY),
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
