import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Client } from 'ssh2';
import { SshDriver } from '../SshDriver.js';
import * as sshKeyLoader from '../../utils/sshKeyLoader.js';

vi.mock('ssh2', () => {
  const MockClient = vi.fn();
  return {
    Client: MockClient,
  };
});

describe('SshDriver', () => {
  let mockClientInstance: any;
  let mockChannel: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      setWindow: vi.fn(),
      end: vi.fn(),
    });

    mockClientInstance = Object.assign(new EventEmitter(), {
      connect: vi.fn(),
      shell: vi.fn(),
      end: vi.fn(),
    });

    (Client as any).mockImplementation(() => mockClientInstance);
    vi.spyOn(sshKeyLoader, 'getSshAuthOptions').mockReturnValue({ privateKey: 'MOCK_KEY' });
  });

  it('should parse user, host, and port correctly and connect', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const onError = vi.fn();

    new SshDriver('ubuntu@192.168.1.50:2222', 100, 30, onData, onExit, onError);

    expect(mockClientInstance.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '192.168.1.50',
        port: 2222,
        username: 'ubuntu',
        privateKey: 'MOCK_KEY',
        readyTimeout: 10000,
      })
    );
  });

  it('should default port to 22 and user to USER or root', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const onError = vi.fn();

    new SshDriver('example.com', 80, 24, onData, onExit, onError);

    expect(mockClientInstance.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'example.com',
        port: 22,
        username: process.env.USER || 'root',
      })
    );
  });

  it('should open shell when client is ready and setup stream handlers', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const onError = vi.fn();

    const driver = new SshDriver('root@localhost', 90, 25, onData, onExit, onError);

    mockClientInstance.shell.mockImplementation((opts: any, cb: Function) => {
      cb(null, mockChannel);
    });

    mockClientInstance.emit('ready');

    expect(mockClientInstance.shell).toHaveBeenCalledWith(
      { term: 'xterm-256color', cols: 90, rows: 25 },
      expect.any(Function)
    );

    mockChannel.emit('data', Buffer.from('hello ssh'));
    expect(onData).toHaveBeenCalledWith('hello ssh');

    mockChannel.emit('close');
    expect(onExit).toHaveBeenCalled();
    expect(mockClientInstance.end).toHaveBeenCalled();
  });

  it('should call onError when shell creation returns an error', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const onError = vi.fn();

    new SshDriver('root@localhost', 80, 24, onData, onExit, onError);

    const err = new Error('Shell error');
    mockClientInstance.shell.mockImplementation((opts: any, cb: Function) => {
      cb(err, null);
    });

    mockClientInstance.emit('ready');
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('should call onError on ssh client error', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const onError = vi.fn();

    new SshDriver('root@localhost', 80, 24, onData, onExit, onError);

    const err = new Error('SSH connection failed');
    mockClientInstance.emit('error', err);

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('should write, resize, and close channel', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const onError = vi.fn();

    const driver = new SshDriver('root@localhost', 80, 24, onData, onExit, onError);

    mockClientInstance.shell.mockImplementation((opts: any, cb: Function) => {
      cb(null, mockChannel);
    });
    mockClientInstance.emit('ready');

    driver.write('ls\n');
    expect(mockChannel.write).toHaveBeenCalledWith('ls\n');

    driver.resize(120, 35);
    expect(mockChannel.setWindow).toHaveBeenCalledWith(35, 120, 0, 0);

    driver.close();
    expect(mockChannel.end).toHaveBeenCalled();
    expect(mockClientInstance.end).toHaveBeenCalled();
  });
});
