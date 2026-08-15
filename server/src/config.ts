import path from 'path';
import os from 'os';

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 8088,
  WS_PATH: '/ws',
  DEFAULT_SHELL: process.env.SHELL || '/bin/bash',
  SSH_KEY_PATHS: [
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
  ],
  SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
};
