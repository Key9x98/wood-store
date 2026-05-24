import { AppError } from '../../lib/errors';
import { ok, err, type Result } from '../../lib/result';
import type { IDeployQueue } from '../../queues/deploy.queue';

/** Narrow site lookup for ownership checks — satisfied by SiteRepository. */
export interface DeploySiteLookup {
  findById(id: number): Promise<{ id: number; ownerId: number } | null>;
}

/** Narrow template lookup — satisfied by TemplateRepository. */
export interface DeployTemplateLookup {
  findById(id: number): Promise<{ id: number; status: string } | null>;
}

export interface Viewer {
  id: number;
  role: string;
}

export class DeployService {
  constructor(
    private sites: DeploySiteLookup,
    private templates: DeployTemplateLookup,
    private queue: IDeployQueue,
  ) {}

  /** Enqueue a job that pushes the site's CURRENT template theme to WordPress. */
  async requestThemeDeploy(
    siteId: number,
    viewer: Viewer,
  ): Promise<Result<{ jobId: string }, AppError>> {
    const access = await this.checkAccess(siteId, viewer);
    if (!access.ok) return access;
    const job = await this.queue.enqueue({ siteId, op: 'deploy-theme' });
    return ok(job);
  }

  /** Enqueue a job that switches the site to a DIFFERENT template. */
  async requestSwitchTemplate(
    siteId: number,
    templateId: number,
    viewer: Viewer,
  ): Promise<Result<{ jobId: string }, AppError>> {
    const access = await this.checkAccess(siteId, viewer);
    if (!access.ok) return access;

    const tpl = await this.templates.findById(templateId);
    if (!tpl) return err(new AppError('deploy.template_not_found', 404));
    if (tpl.status !== 'ready') return err(new AppError('deploy.template_not_ready', 409));

    const job = await this.queue.enqueue({ siteId, op: 'switch-template', templateId });
    return ok(job);
  }

  private async checkAccess(
    siteId: number,
    viewer: Viewer,
  ): Promise<Result<true, AppError>> {
    const site = await this.sites.findById(siteId);
    if (!site) return err(new AppError('deploy.site_not_found', 404));
    if (viewer.role !== 'admin' && site.ownerId !== viewer.id) {
      return err(new AppError('deploy.forbidden', 403));
    }
    return ok(true);
  }
}
