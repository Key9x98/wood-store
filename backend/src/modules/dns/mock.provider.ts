import { randomBytes } from 'node:crypto';
import type { DnsProvider } from './dns.provider';
import type { DnsRecord, UpsertARequest, FindRecordRequest, DeleteRecordRequest } from './dns.types';

/**
 * In-memory DnsProvider for dev/test. Idempotent.
 */
export class MockDnsProvider implements DnsProvider {
  // zone -> recordId -> DnsRecord
  private byZone = new Map<string, Map<string, DnsRecord>>();

  async findRecord(req: FindRecordRequest): Promise<DnsRecord | null> {
    const zone = this.byZone.get(req.zone);
    if (!zone) return null;
    for (const r of zone.values()) {
      if (r.name === req.name && (!req.type || r.type === req.type)) return { ...r };
    }
    return null;
  }

  async upsertA(req: UpsertARequest): Promise<DnsRecord> {
    const existing = await this.findRecord({ zone: req.zone, name: req.name, type: 'A' });
    if (existing) {
      existing.content = req.content;
      existing.ttl = req.ttl ?? existing.ttl;
      existing.proxied = req.proxied ?? existing.proxied;
      this.byZone.get(req.zone)!.set(existing.id, existing);
      return { ...existing };
    }
    const record: DnsRecord = {
      id: `mock-${randomBytes(6).toString('hex')}`,
      zone: req.zone,
      name: req.name,
      type: 'A',
      content: req.content,
      ttl: req.ttl ?? 300,
      proxied: req.proxied ?? false,
    };
    let zone = this.byZone.get(req.zone);
    if (!zone) {
      zone = new Map();
      this.byZone.set(req.zone, zone);
    }
    zone.set(record.id, record);
    return { ...record };
  }

  async deleteRecord(req: DeleteRecordRequest): Promise<void> {
    const zone = this.byZone.get(req.zone);
    if (!zone) return;
    zone.delete(req.recordId);
  }

  /** Test helper. */
  list(zone: string): DnsRecord[] {
    return Array.from(this.byZone.get(zone)?.values() ?? []).map((r) => ({ ...r }));
  }
}
