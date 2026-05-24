import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
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
    private stagingDir: string,
  ) {}

  /**
   * Persist the uploaded theme .zip to disk and enqueue the import job.
   * Re-importing an existing slug updates that theme (idempotent).
   */
  async startImport(input: ImportTemplateInput): Promise<Result<ImportTriggerResult, AppError>> {
    const zipBytes = Buffer.from(input.zipBase64, 'base64');
    if (zipBytes.length === 0) {
      return err(new AppError('templates.invalid_zip', 400));
    }

    await fs.mkdir(this.stagingDir, { recursive: true });
    const zipPath = path.join(
      this.stagingDir,
      `upload-${input.slug}-${Date.now()}-${randomBytes(4).toString('hex')}.zip`,
    );
    await fs.writeFile(zipPath, zipBytes);

    const existing = await this.repo.findBySlug(input.slug);
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

    const job = await this.queue.enqueue({ templateId: row.id, slug: input.slug, zipPath });
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
