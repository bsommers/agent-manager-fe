import { Client, ClientChannel } from 'ssh2';
import { getSshAuthOptions } from '../utils/sshKeyLoader.js';

export class SshDriver {
  private sshClient: Client;
  private channel: ClientChannel | null = null;

  constructor(
    targetHost: string,
    cols: number = 80,
    rows: number = 24,
    onData: (data: string) => void,
    onExit: () => void,
    onError: (err: Error) => void
  ) {
    this.sshClient = new Client();

    // Parse user@host:port
    const [userHost, portStr] = targetHost.split(':');
    const port = portStr ? parseInt(portStr, 10) : 22;
    const [username, host] = userHost.includes('@')
      ? userHost.split('@')
      : [process.env.USER || 'root', userHost];

    const authOptions = getSshAuthOptions();

    this.sshClient.on('ready', () => {
      this.sshClient.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          onError(err);
          return;
        }

        this.channel = stream;
        stream.on('data', (data: Buffer) => onData(data.toString('utf8')));
        stream.on('close', () => {
          onExit();
          this.sshClient.end();
        });
      });
    });

    this.sshClient.on('error', (err) => {
      onError(err);
    });

    this.sshClient.connect({
      host,
      port,
      username,
      ...authOptions,
      readyTimeout: 10000,
    });
  }

  write(data: string) {
    if (this.channel) {
      this.channel.write(data);
    }
  }

  resize(cols: number, rows: number) {
    if (this.channel) {
      this.channel.setWindow(rows, cols, 0, 0);
    }
  }

  close() {
    if (this.channel) {
      this.channel.end();
    }
    this.sshClient.end();
  }
}
