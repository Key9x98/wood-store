import type { PrismaClient, Prisma, Template } from '@prisma/client';

export interface TemplateCreateData {
  slug: string;
  name: string;
  version: string;
  manifest: Prisma.InputJsonValue;
  localPath: string;
  status: string;
}

export interface TemplateUpdateData {
  name?: string;
  version?: string;
  manifest?: Prisma.InputJsonValue;
  localPath?: string;
  status?: string;
}

export interface ListOpts {
  limit: number;
  offset: number;
  status?: string;
}

export interface ITemplateRepository {
  findById(id: number): Promise<Template | null>;
  findBySlug(slug: string): Promise<Template | null>;
  create(data: TemplateCreateData): Promise<Template>;
  update(id: number, patch: TemplateUpdateData): Promise<Template>;
  delete(id: number): Promise<Template>;
  list(opts: ListOpts): Promise<Template[]>;
  count(opts: Pick<ListOpts, 'status'>): Promise<number>;
}

export class TemplateRepository implements ITemplateRepository {
  constructor(private db: PrismaClient) {}

  findById(id: number) {
    return this.db.template.findUnique({ where: { id } });
  }

  findBySlug(slug: string) {
    return this.db.template.findUnique({ where: { slug } });
  }

  create(data: TemplateCreateData) {
    return this.db.template.create({ data });
  }

  update(id: number, patch: TemplateUpdateData) {
    return this.db.template.update({ where: { id }, data: patch });
  }

  delete(id: number) {
    return this.db.template.delete({ where: { id } });
  }

  list(opts: ListOpts) {
    return this.db.template.findMany({
      where: { status: opts.status },
      take: opts.limit,
      skip: opts.offset,
      orderBy: { id: 'desc' },
    });
  }

  count(opts: Pick<ListOpts, 'status'>) {
    return this.db.template.count({ where: { status: opts.status } });
  }
}
