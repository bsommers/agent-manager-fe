import { describe, it, expect, beforeEach } from 'vitest';
import { useLogBufferStore, logBufferStore, LogSearchResult } from '../logBufferStore';
import { agentSocket } from '../../services/agentSocket';

describe('logBufferStore', () => {
  beforeEach(() => {
    logBufferStore.clearBuffer();
  });

  it('should append log output and create log entries per agent', () => {
    logBufferStore.appendOutput('agent-1', 'Initial startup sequence completed\n');
    logBufferStore.appendOutput('agent-1', 'Server listening on port 8080\n');
    logBufferStore.appendOutput('agent-2', 'Worker thread spawned\n');

    const agent1Logs = logBufferStore.getAgentLogs('agent-1');
    const agent2Logs = logBufferStore.getAgentLogs('agent-2');

    expect(agent1Logs.length).toBe(2);
    expect(agent1Logs[0].agentId).toBe('agent-1');
    expect(agent1Logs[0].text).toBe('Initial startup sequence completed');
    expect(agent1Logs[0].timestamp).toBeGreaterThan(0);
    expect(agent1Logs[0].id).toBeDefined();

    expect(agent1Logs[1].text).toBe('Server listening on port 8080');

    expect(agent2Logs.length).toBe(1);
    expect(agent2Logs[0].agentId).toBe('agent-2');
    expect(agent2Logs[0].text).toBe('Worker thread spawned');
  });

  it('should handle multiline chunks and strip ANSI escape sequences', () => {
    const rawAnsiChunk = '\x1b[32m[SUCCESS]\x1b[0m Build passed\r\n\x1b[33m[WARN]\x1b[0m Deprecated package\r\n';
    logBufferStore.appendOutput('agent-1', rawAnsiChunk);

    const logs = logBufferStore.getAgentLogs('agent-1');
    expect(logs.length).toBe(2);
    expect(logs[0].text).toBe('[SUCCESS] Build passed');
    expect(logs[1].text).toBe('[WARN] Deprecated package');
  });

  it('should enforce a hard cap of 10,000 lines ring buffer per agent', () => {
    // Generate 10,050 lines
    const batchSize = 10050;
    const lines: string[] = [];
    for (let i = 0; i < batchSize; i++) {
      lines.push(`Log message line ${i}`);
    }
    logBufferStore.appendOutput('agent-stress', lines.join('\n'));

    const logs = logBufferStore.getAgentLogs('agent-stress');
    expect(logs.length).toBe(10000);
    // Oldest 50 lines (0..49) dropped; first remaining is line 50
    expect(logs[0].text).toBe('Log message line 50');
    // Last line is line 10049
    expect(logs[logs.length - 1].text).toBe('Log message line 10049');
  });

  it('should search logs across all agents using substring match', () => {
    logBufferStore.appendOutput('agent-1', 'Database connection established\n');
    logBufferStore.appendOutput('agent-1', 'Query executed in 42ms\n');
    logBufferStore.appendOutput('agent-2', 'Database backup started\n');
    logBufferStore.appendOutput('agent-3', 'Redis cache warmed up\n');

    const results: LogSearchResult[] = logBufferStore.searchLogs('Database');
    expect(results.length).toBe(2);
    expect(results[0].line.agentId).toBe('agent-1');
    expect(results[0].line.text).toBe('Database connection established');
    expect(results[0].matchIndex).toBe(0);

    expect(results[1].line.agentId).toBe('agent-2');
    expect(results[1].line.text).toBe('Database backup started');
    expect(results[1].matchIndex).toBe(0);
  });

  it('should support case-insensitive and case-sensitive substring searching', () => {
    logBufferStore.appendOutput('agent-1', 'FATAL ERROR: connection timeout\n');
    logBufferStore.appendOutput('agent-2', 'Non-fatal error: retry queued\n');

    const caseInsensitiveResults = logBufferStore.searchLogs('fatal error');
    expect(caseInsensitiveResults.length).toBe(2);

    const caseSensitiveResults = logBufferStore.searchLogs('FATAL ERROR', { caseSensitive: true });
    expect(caseSensitiveResults.length).toBe(1);
    expect(caseSensitiveResults[0].line.agentId).toBe('agent-1');
  });

  it('should support filtering search by agentId', () => {
    logBufferStore.appendOutput('agent-1', 'Common heartbeat message\n');
    logBufferStore.appendOutput('agent-2', 'Common heartbeat message\n');

    const results = logBufferStore.searchLogs('heartbeat', { agentId: 'agent-2' });
    expect(results.length).toBe(1);
    expect(results[0].line.agentId).toBe('agent-2');
  });

  it('should search logs using regular expressions', () => {
    logBufferStore.appendOutput('agent-1', 'HTTP GET /api/v1/users 200 OK\n');
    logBufferStore.appendOutput('agent-1', 'HTTP POST /api/v1/orders 500 INTERNAL_ERROR\n');
    logBufferStore.appendOutput('agent-2', 'HTTP GET /health 200 OK\n');

    const regexResults = logBufferStore.searchLogs('HTTP\\s+(GET|POST).*5\\d{2}', { isRegex: true });
    expect(regexResults.length).toBe(1);
    expect(regexResults[0].line.agentId).toBe('agent-1');
    expect(regexResults[0].line.text).toContain('500 INTERNAL_ERROR');
    expect(regexResults[0].matchIndex).toBe(0);
  });

  it('should handle invalid regex patterns gracefully without throwing', () => {
    logBufferStore.appendOutput('agent-1', 'Sample output\n');
    expect(() => {
      const results = logBufferStore.searchLogs('[unclosed-bracket', { isRegex: true });
      expect(results).toEqual([]);
    }).not.toThrow();
  });

  it('should clear buffer for a specific agent or all agents', () => {
    logBufferStore.appendOutput('agent-1', 'Line 1\n');
    logBufferStore.appendOutput('agent-2', 'Line 2\n');

    logBufferStore.clearBuffer('agent-1');
    expect(logBufferStore.getAgentLogs('agent-1')).toEqual([]);
    expect(logBufferStore.getAgentLogs('agent-2').length).toBe(1);

    logBufferStore.clearBuffer();
    expect(logBufferStore.getAgentLogs('agent-2')).toEqual([]);
  });

  it('should automatically append output from agentSocket agent:output events', () => {
    // Send output via agentSocket
    agentSocket.send({
      type: 'agent:input',
      agentId: 'agent-socket-test',
      data: 'echo "hello from socket"\r',
    });

    const logs = logBufferStore.getAgentLogs('agent-socket-test');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.text.includes('hello from socket') || l.text.includes('echo'))).toBe(true);
  });
});
