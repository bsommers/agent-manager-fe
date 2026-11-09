import { describe, it, expect } from 'vitest';
import { hostnameOf } from '../apiRouter.js';

describe('hostnameOf', () => {
  it.each([
    ['localhost', 'localhost'],
    ['LocalHost:3000', 'localhost'],
    ['127.0.0.1:8088', '127.0.0.1'],
    ['[::1]', '[::1]'],
    ['[::1]:8088', '[::1]'],
    ['evil.example:80', 'evil.example'],
  ])('parses %s', (header, expected) => {
    expect(hostnameOf(header)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    ' ',
    'a@b',
    'a/b',
    'a b',
    'host:',
    'host:123456',
    'host:80:90',
    '::1',
    '[::1',
    'host\u0000',
    'host,other',
  ])('rejects %j', (header) => {
    expect(hostnameOf(header as string | undefined)).toBeNull();
  });
});
