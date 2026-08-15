import pty from 'node-pty';
import { CONFIG } from '../config.js';

export class TmuxDriver {
  private ptyProcess: pty.IPty;

  constructor(
    sessionName: string,
    cols: number = 80,
    rows: number = 24,
    onData: (data: string) => void,
    onExit: (code: number) => void
  ) {
    // Spawn tmux new-session -A -s <name> (-A attaches if exists, creates if new)
    this.ptyProcess = pty.spawn('tmux', ['new-session', '-A', '-s', sessionName], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME || process.cwd(),
      env: process.env as Record<string, string>,
    });

    this.ptyProcess.onData(onData);
    this.ptyProcess.onExit((e) => onExit(e.exitCode));
  }

  write(data: string) {
    this.ptyProcess.write(data);
  }

  resize(cols: number, rows: number) {
    try {
      this.ptyProcess.resize(cols, rows);
    } catch (err) {
      // Ignore bounds error
    }
  }

  close() {
    try {
      this.ptyProcess.kill();
    } catch (err) {
      // Ignore kill error
    }
  }
}
