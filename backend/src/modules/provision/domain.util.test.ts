import { describe, it, expect } from 'vitest';
import { rootDomain, dbNameFromDomain } from './domain.util';

describe('rootDomain', () => {
  it.each([
    ['abc.com', 'abc.com'],
    ['sub.abc.com', 'abc.com'],
    ['deep.sub.abc.com', 'abc.com'],
    ['ABC.COM', 'abc.com'],
  ])('rootDomain(%s) = %s', (input, expected) => {
    expect(rootDomain(input)).toBe(expected);
  });

  it('throws on invalid', () => {
    expect(() => rootDomain('localhost')).toThrow();
  });
});

describe('dbNameFromDomain', () => {
  it.each([
    ['abc.com', 'wp_abc_com'],
    ['sub.abc.com', 'wp_sub_abc_com'],
    ['ABC.COM', 'wp_abc_com'],
    ['a-b.com', 'wp_a_b_com'],
  ])('dbNameFromDomain(%s) = %s', (input, expected) => {
    expect(dbNameFromDomain(input)).toBe(expected);
  });
});
