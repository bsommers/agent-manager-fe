/** Wire error vocabulary (contract spec section 6.2). */
export const ERROR_CODES = Object.freeze([
  'USAGE',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNSUPPORTED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'BACKEND_DOWN',
  'TIMEOUT',
  'INTERNAL',
] as const);

export type ErrorCode = (typeof ERROR_CODES)[number];

/** FE error taxonomy; "network" is client-only and has no wire code. */
export type ErrorClass = 'protocol' | 'auth' | 'backend' | 'timeout';

export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  USAGE: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNSUPPORTED: 422,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  BACKEND_DOWN: 503,
  TIMEOUT: 504,
  INTERNAL: 500,
});

const ERROR_CLASS: Readonly<Record<ErrorCode, ErrorClass>> = Object.freeze({
  USAGE: 'protocol',
  UNAUTHENTICATED: 'auth',
  FORBIDDEN: 'auth',
  NOT_FOUND: 'backend',
  CONFLICT: 'backend',
  UNSUPPORTED: 'protocol',
  RATE_LIMITED: 'backend',
  PAYLOAD_TOO_LARGE: 'protocol',
  BACKEND_DOWN: 'backend',
  TIMEOUT: 'timeout',
  INTERNAL: 'backend',
});

export function errorClassOf(code: ErrorCode): ErrorClass {
  return ERROR_CLASS[code];
}

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['RATE_LIMITED', 'BACKEND_DOWN', 'TIMEOUT']);

/** Default `retryable` flag for a code; the gateway may override per occurrence. */
export function isRetryableByDefault(code: ErrorCode): boolean {
  return RETRYABLE.has(code);
}

/** HTTP error body: `{ ok: false, error: { code, message, retryable, detail? } }`. */
export interface ErrorEnvelope {
  ok: false;
  error: { code: ErrorCode; message: string; retryable: boolean; detail?: unknown };
}
