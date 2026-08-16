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

  it('should handle clear mock command', () => {
    const output = MockStreamGenerator.handleMockCommand('clear', 'Dev Agent');
    expect(output).toContain('\x1bc');
  });

  it('should handle unknown command with bash error message', () => {
    const output = MockStreamGenerator.handleMockCommand('foobar_cmd', 'Dev Agent');
    expect(output).toContain('bash: foobar_cmd: command not found');
  });

  describe('processInput streaming buffer', () => {
    it('should buffer character inputs and evaluate command on Enter (\\r)', () => {
      const agentId = 'stream-agent-1';
      expect(MockStreamGenerator.processInput(agentId, 'h')).toBe('h');
      expect(MockStreamGenerator.processInput(agentId, 'e')).toBe('e');
      expect(MockStreamGenerator.processInput(agentId, 'l')).toBe('l');
      expect(MockStreamGenerator.processInput(agentId, 'p')).toBe('p');

      const result = MockStreamGenerator.processInput(agentId, '\r');
      expect(result).toContain('Available mock commands:');
    });

    it('should handle backspace (\\u007F) in buffer', () => {
      const agentId = 'stream-agent-2';
      MockStreamGenerator.processInput(agentId, 'x');
      const backspaceResult = MockStreamGenerator.processInput(agentId, '\u007F');
      expect(backspaceResult).toBe('\b \b');

      // Empty buffer backspace returns empty string
      expect(MockStreamGenerator.processInput(agentId, '\u007F')).toBe('');
    });

    it('should handle Ctrl+C (\\x03) interrupt signal', () => {
      const agentId = 'stream-agent-3';
      MockStreamGenerator.processInput(agentId, 'partial command');
      const ctrlCResult = MockStreamGenerator.processInput(agentId, '\x03', 'Dev Agent');
      expect(ctrlCResult).toContain('^C');
      expect(ctrlCResult).toContain('agent@dev-agent:~$');
    });

    it('should execute direct command string passed with newline', () => {
      const result = MockStreamGenerator.processInput('stream-agent-4', 'status\n');
      expect(result).toContain('[AGENT METRICS]');
    });
  });
});
