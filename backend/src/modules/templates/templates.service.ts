import type { Template } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { ok, err, type Result } from '../../lib/result';
import type { ITemplateImportQueue } from '../../queues/template-import.queue';
import type { ITemplateRepository } from './templates.repository';
import type { ImportTemplateInput, ListTemplatesInput } from './templates.schema';

export interface ImportTriggerResult {
  templateId: number;
  jobId: string;
}

export class TemplateService {
  constructor(
    private repo: ITemplateRepository,
    private queue: ITemplateImportQueue,
  ) {}

  async startImport(input: ImportTemplateInput): Promise<Result<ImportTriggerResult, AppError>> {
    const existing = await this.repo.findBySlug(input.slug);
    if (existing && existing.status === 'ready') {
      return err(new AppError('templates.already_exists', 409));
    }

    const row = existing
      ? await this.repo.update(existing.id, { status: 'building' })
      : await this.repo.create({
          slug: input.slug,
          name: input.slug,
          version: '0.0.0',
          manifest: { __placeholder: true },
          localPath: '',
          status: 'building',
        });

    const job = await this.queue.enqueue({
      templateId: row.id,
      slug: input.slug,
      source: input.source,
    });

    return ok({ templateId: row.id, jobId: job.jobId });
  }

  async findById(id: number): Promise<Result<Template, AppError>> {
    const t = await this.repo.findById(id);
    if (!t) return err(new AppError('templates.not_found', 404));
    return ok(t);
  }

  async findBySlug(slug: string): Promise<Result<Template, AppError>> {
    const t = await this.repo.findBySlug(slug);
    if (!t) return err(new AppError('templates.not_found', 404));
    return ok(t);
  }

  async list(
    input: ListTemplatesInput,
    viewerRole: string,
  ): Promise<{ items: Template[]; total: number }> {
    const status = viewerRole === 'admin' ? input.status : 'ready';
    const [items, total] = await Promise.all([
      this.repo.list({ limit: input.limit, offset: input.offset, status }),
      this.repo.count({ status }),
    ]);
    return { items, total };
  }

  async remove(id: number): Promise<Result<true, AppError>> {
    const t = await this.repo.findById(id);
    if (!t) return err(new AppError('templates.not_found', 404));
    await this.repo.delete(id);
    return ok(true);
  }
}
