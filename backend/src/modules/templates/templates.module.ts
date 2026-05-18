import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { TemplateRepository } from './templates.repository';
import { TemplateService } from './templates.service';
import { TemplateImportService } from './template-import.service';
import { TemplateImportQueueAdapter } from '../../queues/template-import.queue';

export const templateRepository = new TemplateRepository(prisma);

export const templatesService = new TemplateService(templateRepository, TemplateImportQueueAdapter);

export const templateImportService = new TemplateImportService(templateRepository, {
  templatesDir: env.TEMPLATES_DIR,
  stagingDir: env.TEMPLATES_STAGING_DIR,
});
