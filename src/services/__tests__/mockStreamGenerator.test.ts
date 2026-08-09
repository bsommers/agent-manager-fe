import { describe, it, expect } from 'vitest';
import { MockStreamGenerator } from '../mockStreamGenerator';

describe('MockStreamGenerator', () => {
  it('should generate an ANSI formatted initial banner with agent info', () => {
    const banner = MockStreamGenerator.getInitialBanner('Dev Agent', 'tmux', 'localhost:dev_1');
    expect(banner).toContain('AI Agent Terminal [Dev Agent]');
    expect(banner).toContain('Mode: TMUX');
    expect(banner).toContain('Target: localhost:dev_1');
    expect(banner).toContain('agent@dev-agent:~$');
  });

  it('should handle help mock command', () => {
    const output = MockStreamGenerator.handleMockCommand('help', 'Dev Agent');
    expect(output).toContain('Available mock commands:');
    expect(output).toContain('status');
    expect(output).toContain('run');
    expect(output).toContain('clear');
    expect(output).toContain('htop');
  });

  it('should handle status mock command', () => {
    const output = MockStreamGenerator.handleMockCommand('status', 'Dev Agent');
    expect(output).toContain('[AGENT METRICS]');
    expect(output).toContain('CPU Usage');
    expect(output).toContain('Memory:');
  });

  it('should handle run mock command', () => {
    const output = MockStreamGenerator.handleMockCommand('run', 'Dev Agent');
    expect(output).toContain('[AI AGENT EXECUTION]');
    expect(output).toContain('Analyzing code repository context');
    expect(output).toContain('Complete.');
  });

  it('should handle unknown command with bash error message', () => {
    const output = MockStreamGenerator.handleMockCommand('foobar_cmd', 'Dev Agent');
    expect(output).toContain('bash: foobar_cmd: command not found');
  });
});
