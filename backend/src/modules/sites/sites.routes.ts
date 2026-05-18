import { Router } from 'express';
import { authRequired } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../lib/async-handler';
import * as controller from './sites.controller';

export const sitesRoutes = Router();

sitesRoutes.use(authRequired);

sitesRoutes.get('/', asyncHandler(controller.listSites));
sitesRoutes.post('/', asyncHandler(controller.createSite));
sitesRoutes.get('/:id', asyncHandler(controller.getSite));
sitesRoutes.delete('/:id', asyncHandler(controller.deleteSite));
