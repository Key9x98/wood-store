import { Router } from 'express';
import { authRequired, role } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../lib/async-handler';
import * as controller from './templates.controller';

export const templatesRoutes = Router();

templatesRoutes.use(authRequired);

templatesRoutes.get('/', asyncHandler(controller.listTemplates));
templatesRoutes.get('/:id', asyncHandler(controller.getTemplate));

templatesRoutes.post('/import', role('admin'), asyncHandler(controller.importTemplate));
templatesRoutes.delete('/:id', role('admin'), asyncHandler(controller.deleteTemplate));
