import { describe, it, expect, beforeEach } from 'vitest';
import { MockDnsProvider } from './mock.provider';

describe('MockDnsProvider', () => {
  let p: MockDnsProvider;
  beforeEach(() => {
    p = new MockDnsProvider();
  });

  it('returns null on findRecord when missing', async () => {
    expect(await p.findRecord({ zone: 'example.com', name: 'a.example.com' })).toBeNull();
  });

  it('upsertA creates a new record', async () => {
    const r = await p.upsertA({ zone: 'example.com', name: 'a.example.com', content: '1.2.3.4' });
    expect(r.id).toMatch(/^mock-/);
    expect(r.type).toBe('A');
    expect(r.content).toBe('1.2.3.4');
    expect(r.ttl).toBe(300);
  });

  it('upsertA is idempotent — second call updates the same record', async () => {
    const r1 = await p.upsertA({ zone: 'example.com', name: 'a.example.com', content: '1.2.3.4' });
    const r2 = await p.upsertA({ zone: 'example.com', name: 'a.example.com', content: '5.6.7.8', ttl: 600 });
    expect(r2.id).toBe(r1.id);
    expect(r2.content).toBe('5.6.7.8');
    expect(r2.ttl).toBe(600);
    expect(p.list('example.com').length).toBe(1);
  });

  it('different names create separate records', async () => {
    await p.upsertA({ zone: 'example.com', name: 'a.example.com', content: '1.1.1.1' });
    await p.upsertA({ zone: 'example.com', name: 'b.example.com', content: '2.2.2.2' });
    expect(p.list('example.com').length).toBe(2);
  });

  it('deleteRecord removes by id', async () => {
    const r = await p.upsertA({ zone: 'example.com', name: 'a.example.com', content: '1.2.3.4' });
    await p.deleteRecord({ zone: 'example.com', recordId: r.id });
    expect(await p.findRecord({ zone: 'example.com', name: 'a.example.com' })).toBeNull();
  });

  it('deleteRecord is idempotent (deleting non-existent does nothing)', async () => {
    await p.deleteRecord({ zone: 'example.com', recordId: 'nonexistent' });
    await p.deleteRecord({ zone: 'unknown-zone', recordId: 'x' });
  });
});
