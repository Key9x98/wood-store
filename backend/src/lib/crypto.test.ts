import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './crypto';

describe('crypto', () => {
  it('round-trips utf8 plaintext', () => {
    const ct = encrypt('hello world 🌏');
    expect(ct).not.toContain('hello');
    expect(decrypt(ct)).toBe('hello world 🌏');
  });

  it('produces different ciphertext per call (random IV)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
  });

  it('throws on tampered ciphertext', () => {
    const ct = encrypt('secret');
    const tampered = Buffer.from(ct, 'base64');
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => decrypt(tampered.toString('base64'))).toThrow();
  });
});
