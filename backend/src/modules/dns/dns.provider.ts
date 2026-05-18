import type { DnsRecord, UpsertARequest, FindRecordRequest, DeleteRecordRequest } from './dns.types';

export interface DnsProvider {
  findRecord(req: FindRecordRequest): Promise<DnsRecord | null>;
  upsertA(req: UpsertARequest): Promise<DnsRecord>;
  deleteRecord(req: DeleteRecordRequest): Promise<void>;
}
