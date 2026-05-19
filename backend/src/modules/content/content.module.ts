import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { decrypt } from '../../lib/crypto';
import { siteRepository } from '../sites/sites.module';
import { createPluginClient } from '../wordpress/plugin-client';
import { ContentSyncQueueAdapter } from '../../queues/content-sync.queue';
import { ContentRepository } from './content.repository';
import { ContentService } from './content.service';
import { ContentSyncService } from './content-sync.service';

export const contentRepository = new ContentRepository(prisma);

// siteRepository structurally satisfies ISiteAccessLookup + ISiteSecretLookup.
export const contentService = new ContentService(
  contentRepository,
  siteRepository,
  ContentSyncQueueAdapter,
);

export const contentSyncService = new ContentSyncService({
  content: contentRepository,
  sites: siteRepository,
  buildClient: (ctx) =>
    createPluginClient({ ...ctx, protocol: env.PROVISION_SKIP_SSL ? 'http' : 'https' }),
  decryptSecret: decrypt,
});
