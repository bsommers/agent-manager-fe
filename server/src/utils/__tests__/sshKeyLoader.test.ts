import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { getSshAuthOptions } from '../sshKeyLoader.js';
import { CONFIG } from '../../config.js';

describe('sshKeyLoader', () => {
  const origSock = CONFIG.SSH_AUTH_SOCK;
  const origKeys = [...CONFIG.SSH_KEY_PATHS];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    CONFIG.SSH_AUTH_SOCK = origSock;
    CONFIG.SSH_KEY_PATHS = origKeys;
  });

  it('returns agent socket if CONFIG.SSH_AUTH_SOCK exists', () => {
    CONFIG.SSH_AUTH_SOCK = '/tmp/test-ssh-agent.sock';
    vi.spyOn(fs, 'existsSync').mockImplementation((path) => path === '/tmp/test-ssh-agent.sock');

    const options = getSshAuthOptions();
    expect(options.agent).toBe('/tmp/test-ssh-agent.sock');
    expect(options.privateKey).toBeUndefined();
  });

  it('reads private key if key file exists and no auth sock', () => {
    CONFIG.SSH_AUTH_SOCK = undefined;
    CONFIG.SSH_KEY_PATHS = ['/home/user/.ssh/id_ed25519'];

    vi.spyOn(fs, 'existsSync').mockImplementation((path) => path === '/home/user/.ssh/id_ed25519');
    vi.spyOn(fs, 'readFileSync').mockReturnValue('FAKE_KEY_CONTENT');

    const options = getSshAuthOptions();
    expect(options.agent).toBeUndefined();
    expect(options.privateKey).toBe('FAKE_KEY_CONTENT');
  });

  it('returns empty options when no sock and no keys exist', () => {
    CONFIG.SSH_AUTH_SOCK = undefined;
    CONFIG.SSH_KEY_PATHS = ['/non/existent/key'];

    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const options = getSshAuthOptions();
    expect(options).toEqual({});
  });
});
