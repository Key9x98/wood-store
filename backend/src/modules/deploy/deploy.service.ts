import { AppError } from '../../lib/errors';
import { ok, err, type Result } from '../../lib/result';
import type { IDeployQueue } from '../../queues/deploy.queue';

/** Narrow site lookup for ownership checks — satisfied by SiteRepository. */
export interface DeploySiteLookup {
  findById(id: number): Promise<{ id: number; ownerId: number } | null>;
}

export interface Viewer {
  id: number;
  role: string;
}

export class DeployService {
  constructor(
    private sites: DeploySiteLookup,
    private queue: IDeployQueue,
  ) {}

  /** Enqueue a job that pushes the site's template theme to its live WordPress. */
  async requestThemeDeploy(
    siteId: number,
    viewer: Viewer,
  ): Promise<Result<{ jobId: string }, AppError>> {
    const site = await this.sites.findById(siteId);
    if (!site) return err(new AppError('deploy.site_not_found', 404));
    if (viewer.role !== 'admin' && site.ownerId !== viewer.id) {
      return err(new AppError('deploy.forbidden', 403));
    }
    const job = await this.queue.enqueue({ siteId, op: 'deploy-theme' });
    return ok(job);
  }
}
