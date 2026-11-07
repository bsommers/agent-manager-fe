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

const rawHost = process.env.HOST?.trim();

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 8088,
  HOST: rawHost ? rawHost : '127.0.0.1',
  WS_PATH: '/ws',
  DEFAULT_SHELL: process.env.SHELL || '/bin/bash',
  SSH_KEY_PATHS: [
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
  ],
  SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
};
