// Generates realistic ANSI formatted terminal output for simulated agents
export class MockStreamGenerator {
  private static colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
  };

  static getInitialBanner(name: string, mode: string, targetHost: string): string {
    const c = this.colors;
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    return (
      `${c.bright}${c.cyan}=== AI Agent Terminal [${name}] ===${c.reset}\r\n` +
      `${c.dim}Mode: ${mode.toUpperCase()} | Target: ${targetHost} | Session Started: ${time}${c.reset}\r\n` +
      `${c.green}System online. Type 'help' for mock commands.${c.reset}\r\n\r\n` +
      `${c.bright}${c.magenta}agent@${name.toLowerCase().replace(/\s+/g, '-')}:~$ ${c.reset}`
    );
  }

  static handleMockCommand(input: string, name: string): string {
    const c = this.colors;
    const cmd = input.trim().toLowerCase();
    const prompt = `\r\n${c.bright}${c.magenta}agent@${name.toLowerCase().replace(/\s+/g, '-')}:~$ ${c.reset}`;

    if (cmd === 'help') {
      return (
        `\r\nAvailable mock commands:\r\n` +
        `  ${c.yellow}status${c.reset}    - Display agent runtime metrics\r\n` +
        `  ${c.yellow}run${c.reset}       - Simulate AI agent execution task\r\n` +
        `  ${c.yellow}clear${c.reset}     - Clear terminal window\r\n` +
        `  ${c.yellow}htop${c.reset}      - Simulate process monitor\r\n` +
        prompt
      );
    }

    if (cmd === 'status') {
      return (
        `\r\n${c.cyan}[AGENT METRICS]${c.reset}\r\n` +
        `  CPU Usage: ${Math.floor(Math.random() * 40 + 5)}%\r\n` +
        `  Memory: 412MB / 2048MB\r\n` +
        `  Active Threads: 4\r\n` +
        `  SSH Status: CONNECTED (0ms latency)\r\n` +
        prompt
      );
    }

    if (cmd === 'run') {
      return (
        `\r\n${c.yellow}[AI AGENT EXECUTION]${c.reset}\r\n` +
        `> Analyzing code repository context...\r\n` +
        `> Generating patch for component layout optimization...\r\n` +
        `${c.green}✓ Step 1/3: Parsing TypeScript AST... Complete.${c.reset}\r\n` +
        `${c.green}✓ Step 2/3: Running test suites... 14 passed.${c.reset}\r\n` +
        `${c.green}✓ Step 3/3: Committing git patch.${c.reset}\r\n` +
        prompt
      );
    }

    return `\r\n${c.red}bash: ${input.trim()}: command not found${c.reset}${prompt}`;
  }
}
