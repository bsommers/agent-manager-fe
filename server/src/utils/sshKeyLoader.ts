import fs from 'fs';
import { CONFIG } from '../config.js';

export interface SshAuthOptions {
  agent?: string;
  privateKey?: string;
}

export function getSshAuthOptions(): SshAuthOptions {
  const options: SshAuthOptions = {};

  if (CONFIG.SSH_AUTH_SOCK && fs.existsSync(CONFIG.SSH_AUTH_SOCK)) {
    options.agent = CONFIG.SSH_AUTH_SOCK;
    return options;
  }

  for (const keyPath of CONFIG.SSH_KEY_PATHS) {
    if (fs.existsSync(keyPath)) {
      try {
        options.privateKey = fs.readFileSync(keyPath, 'utf8');
        return options;
      } catch (err) {
        // Continue to next keyfile
      }
    }
  }

  return options;
}
