import { prisma } from '../../db/prisma';
import { SiteRepository } from './sites.repository';
import { SiteService } from './sites.service';
import { ProvisionQueueAdapter } from '../../queues/provision.queue';
import { templateRepository } from '../templates/templates.module';

export const siteRepository = new SiteRepository(prisma);
// templateRepository (from templates module) structurally satisfies ITemplateLookup.
export const sitesService = new SiteService(siteRepository, templateRepository, ProvisionQueueAdapter);
