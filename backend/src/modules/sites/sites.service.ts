import type { Site } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { ok, err, type Result } from '../../lib/result';
import type { IProvisionQueue } from '../../queues/provision.queue';
import type {
  ISiteRepository,
  ITemplateLookup,
  ListOpts,
} from './sites.repository';
import type { CreateSiteInput, ListSitesInput } from './sites.schema';

export class SiteService {
  constructor(
    private repo: ISiteRepository,
    private templates: ITemplateLookup,
    private queue: IProvisionQueue,
  ) {}

  async create(
    input: CreateSiteInput,
    ownerId: number,
  ): Promise<Result<Site, AppError>> {
    const existing = await this.repo.findByDomain(input.domain);
    if (existing) return err(new AppError('sites.domain_taken', 409));

    const tpl = await this.templates.findById(input.templateId);
    if (!tpl) return err(new AppError('sites.template_not_found', 404));
    if (tpl.status !== 'ready') return err(new AppError('sites.template_not_ready', 409));

    const site = await this.repo.create({
      domain: input.domain,
      templateId: input.templateId,
      ownerId,
      status: 'queued',
    });

    await this.queue.enqueue({ siteId: site.id });

    return ok(site);
  }

  async findById(id: number, viewer: { id: number; role: string }): Promise<Result<Site, AppError>> {
    const s = await this.repo.findById(id);
    if (!s) return err(new AppError('sites.not_found', 404));
    if (viewer.role !== 'admin' && s.ownerId !== viewer.id) {
      return err(new AppError('sites.forbidden', 403));
    }
    return ok(s);
  }

  async list(
    input: ListSitesInput,
    viewer: { id: number; role: string },
  ): Promise<{ items: Site[]; total: number }> {
    const opts: ListOpts = {
      limit: input.limit,
      offset: input.offset,
      ownerId: viewer.role === 'admin' ? undefined : viewer.id,
      status: input.status,
    };
    const [items, total] = await Promise.all([
      this.repo.list(opts),
      this.repo.count({ ownerId: opts.ownerId, status: opts.status }),
    ]);
    return { items, total };
  }

  async remove(
    id: number,
    viewer: { id: number; role: string },
  ): Promise<Result<true, AppError>> {
    const s = await this.repo.findById(id);
    if (!s) return err(new AppError('sites.not_found', 404));
    if (viewer.role !== 'admin' && s.ownerId !== viewer.id) {
      return err(new AppError('sites.forbidden', 403));
    }
    // Milestone 2: soft-mark deleted. Milestone 5 will enqueue rollback to undo infra.
    await this.repo.updateStatus(id, 'deleted');
    return ok(true);
  }
}
