import { execFile } from 'child_process';
import { promisify } from 'util';
import { Agent } from '../protocol/wsProtocol.js';

const execFileAsync = promisify(execFile);

export async function discoverTmuxSessions(): Promise<Agent[]> {
  try {
    const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}']);
    const sessionNames = stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    return sessionNames.map((name, idx) => ({
      id: `tmux-${name}`,
      name: `Tmux: ${name}`,
      mode: 'tmux',
      targetHost: `localhost:${name}`,
      status: 'running',
      unreadOutput: false,
      layout: { isFloating: false },
      createdAt: Date.now() - idx * 60000,
      lastActivity: Date.now(),
    }));
  } catch (err) {
    // If tmux is not running or not installed, return empty list
    return [];
  }
}
