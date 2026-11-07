/** Gateway capabilities, listed per backend in hello_ack (contract spec section 9.1). */
export const GATEWAY_CAPABILITIES = Object.freeze([
  'terminal',
  'broadcast',
  'search',
  'history',
  'tasks',
  'cost',
  'quota',
  'sandbox',
  'pipeline',
  'gates',
  'route',
] as const);

/** Agent capabilities, per agent (contract spec section 9.2). */
export const AGENT_CAPABILITIES = Object.freeze([
  'input',
  'resize',
  'kill',
  'history',
  'broadcast',
  'approve',
  'snapshot',
] as const);

export type GatewayCapability = (typeof GATEWAY_CAPABILITIES)[number];
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

/** Assumed when Agent.capabilities is absent (contract spec section 9.3). */
export const DEFAULT_AGENT_CAPABILITIES: readonly AgentCapability[] = Object.freeze([
  'input',
  'resize',
  'kill',
  'history',
  'broadcast',
] as const);
