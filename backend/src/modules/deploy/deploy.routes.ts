import { Router } from 'express';
import { authRequired } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../lib/async-handler';
import * as controller from './deploy.controller';

// Mounted at /api/sites — POST /api/sites/:siteId/deploy-theme
export const deployRoutes = Router();

deployRoutes.use(authRequired);

deployRoutes.post('/:siteId/deploy-theme', asyncHandler(controller.deployTheme));
deployRoutes.post('/:siteId/switch-template', asyncHandler(controller.switchTemplate));
