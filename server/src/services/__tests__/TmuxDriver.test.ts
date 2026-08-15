import { describe, it, expect, vi, beforeEach } from 'vitest';
import pty from 'node-pty';
import { TmuxDriver } from '../TmuxDriver.js';

vi.mock('node-pty', () => {
  return {
    default: {
      spawn: vi.fn(),
    },
    spawn: vi.fn(),
  };
});

describe('TmuxDriver', () => {
  let mockPtyProcess: any;
  let onDataCallback: any;
  let onExitCallback: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPtyProcess = {
      onData: vi.fn((cb) => {
        onDataCallback = cb;
      }),
      onExit: vi.fn((cb) => {
        onExitCallback = cb;
      }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };
    (pty.spawn as any).mockReturnValue(mockPtyProcess);
  });

  it('should spawn pty with correct tmux arguments and options', () => {
    const onData = vi.fn();
    const onExit = vi.fn();

    const driver = new TmuxDriver('test-session', 100, 30, onData, onExit);

    expect(pty.spawn).toHaveBeenCalledWith(
      'tmux',
      ['new-session', '-A', '-s', 'test-session'],
      expect.objectContaining({
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
      })
    );
    expect(mockPtyProcess.onData).toHaveBeenCalled();
    expect(mockPtyProcess.onExit).toHaveBeenCalled();
  });

  it('should forward data to onData callback', () => {
    const onData = vi.fn();
    const onExit = vi.fn();

    new TmuxDriver('test-session', 80, 24, onData, onExit);

    onDataCallback('hello terminal');
    expect(onData).toHaveBeenCalledWith('hello terminal');
  });

  it('should forward exit code to onExit callback', () => {
    const onData = vi.fn();
    const onExit = vi.fn();

    new TmuxDriver('test-session', 80, 24, onData, onExit);

    onExitCallback({ exitCode: 0 });
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it('should write data to pty process', () => {
    const driver = new TmuxDriver('test-session', 80, 24, vi.fn(), vi.fn());
    driver.write('ls -la\n');
    expect(mockPtyProcess.write).toHaveBeenCalledWith('ls -la\n');
  });

  it('should resize pty process and handle errors gracefully', () => {
    const driver = new TmuxDriver('test-session', 80, 24, vi.fn(), vi.fn());
    driver.resize(120, 40);
    expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40);

    mockPtyProcess.resize.mockImplementationOnce(() => {
      throw new Error('Resize failed');
    });
    expect(() => driver.resize(0, 0)).not.toThrow();
  });

  it('should kill pty process on close and handle errors gracefully', () => {
    const driver = new TmuxDriver('test-session', 80, 24, vi.fn(), vi.fn());
    driver.close();
    expect(mockPtyProcess.kill).toHaveBeenCalled();

    mockPtyProcess.kill.mockImplementationOnce(() => {
      throw new Error('Kill failed');
    });
    expect(() => driver.close()).not.toThrow();
  });
});
