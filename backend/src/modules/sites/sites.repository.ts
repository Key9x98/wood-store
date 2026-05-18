import type { PrismaClient, Prisma, Site } from '@prisma/client';

export interface SiteCreateData {
  domain: string;
  templateId: number;
  ownerId: number;
  status: string;
}

export interface ListOpts {
  limit: number;
  offset: number;
  ownerId?: number;
  status?: string;
}

export interface DbCredentials {
  dbName: string;
  dbUser: string;
  dbPasswordEnc: string;
}

export interface ISiteRepository {
  findById(id: number): Promise<Site | null>;
  findByDomain(domain: string): Promise<Site | null>;
  create(data: SiteCreateData): Promise<Site>;
  updateStatus(id: number, status: string): Promise<Site>;
  delete(id: number): Promise<Site>;
  list(opts: ListOpts): Promise<Site[]>;
  count(opts: Pick<ListOpts, 'ownerId' | 'status'>): Promise<number>;

  // Provision-state lifecycle
  transitionToProvisioning(id: number): Promise<Site | null>;
  updateProvisionState(id: number, state: Prisma.InputJsonValue): Promise<Site>;
  updateDbCredentials(id: number, creds: DbCredentials): Promise<Site>;
  markActive(id: number): Promise<Site>;
  markFailed(id: number, reason?: string): Promise<Site>;
}

export class SiteRepository implements ISiteRepository {
  constructor(private db: PrismaClient) {}

  findById(id: number) {
    return this.db.site.findUnique({ where: { id } });
  }

  findByDomain(domain: string) {
    return this.db.site.findUnique({ where: { domain } });
  }

  create(data: SiteCreateData) {
    return this.db.site.create({ data });
  }

  updateStatus(id: number, status: string) {
    return this.db.site.update({ where: { id }, data: { status } });
  }

  delete(id: number) {
    return this.db.site.delete({ where: { id } });
  }

  list(opts: ListOpts) {
    return this.db.site.findMany({
      where: { ownerId: opts.ownerId, status: opts.status },
      take: opts.limit,
      skip: opts.offset,
      orderBy: { id: 'desc' },
    });
  }

  count(opts: Pick<ListOpts, 'ownerId' | 'status'>) {
    return this.db.site.count({
      where: { ownerId: opts.ownerId, status: opts.status },
    });
  }

  async transitionToProvisioning(id: number): Promise<Site | null> {
    // Atomically claim: only proceed if current status is queued or provisioning.
    const result = await this.db.site.updateMany({
      where: { id, status: { in: ['queued', 'provisioning'] } },
      data: { status: 'provisioning' },
    });
    if (result.count === 0) return null;
    return this.db.site.findUnique({ where: { id } });
  }

  updateProvisionState(id: number, state: Prisma.InputJsonValue) {
    return this.db.site.update({ where: { id }, data: { provisionState: state } });
  }

  updateDbCredentials(id: number, creds: DbCredentials) {
    return this.db.site.update({
      where: { id },
      data: {
        dbName: creds.dbName,
        dbUser: creds.dbUser,
        dbPasswordEnc: creds.dbPasswordEnc,
      },
    });
  }

  markActive(id: number) {
    return this.db.site.update({
      where: { id },
      data: { status: 'active', provisionedAt: new Date() },
    });
  }

  markFailed(id: number, _reason?: string) {
    return this.db.site.update({ where: { id }, data: { status: 'failed' } });
  }
}

// Narrow lookup interface that SiteService depends on.
// Satisfied by TemplateRepository in the templates module.
export interface ITemplateLookup {
  findById(id: number): Promise<{ id: number; status: string } | null>;
}
