import { describe, it, expect } from 'vitest';
import { ERROR_CODES, ERROR_HTTP_STATUS, errorClassOf, isRetryableByDefault } from '../index.js';

describe('error vocabulary (contract spec section 6.2)', () => {
  it('lists exactly the eleven codes', () => {
    expect([...ERROR_CODES]).toEqual([
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
    ]);
  });

  it('maps every code to its HTTP status', () => {
    expect({ ...ERROR_HTTP_STATUS }).toEqual({
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
  });

  it('maps every code to its error class', () => {
    expect(Object.fromEntries(ERROR_CODES.map((c) => [c, errorClassOf(c)]))).toEqual({
      USAGE: 'protocol',
      PAYLOAD_TOO_LARGE: 'protocol',
      UNSUPPORTED: 'protocol',
      UNAUTHENTICATED: 'auth',
      FORBIDDEN: 'auth',
      NOT_FOUND: 'backend',
      CONFLICT: 'backend',
      RATE_LIMITED: 'backend',
      INTERNAL: 'backend',
      BACKEND_DOWN: 'backend',
      TIMEOUT: 'timeout',
    });
  });

  it('marks only RATE_LIMITED, BACKEND_DOWN and TIMEOUT retryable by default', () => {
    expect(ERROR_CODES.filter((c) => isRetryableByDefault(c))).toEqual([
      'RATE_LIMITED',
      'BACKEND_DOWN',
      'TIMEOUT',
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(ERROR_HTTP_STATUS)).toBe(true);
  });
});
