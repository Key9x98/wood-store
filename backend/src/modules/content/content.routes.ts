import { Router } from 'express';
import { authRequired } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../lib/async-handler';
import * as controller from './content.controller';

// Content is nested under a site: /api/sites/:siteId/products...
// Mounted at /api/sites alongside sitesRoutes — paths never collide because
// every route here has a /products or /resync segment after :siteId.
export const contentRoutes = Router();

contentRoutes.use(authRequired);

contentRoutes.post('/:siteId/products/bulk-import', asyncHandler(controller.bulkImport));
contentRoutes.post('/:siteId/resync', asyncHandler(controller.resyncSite));

contentRoutes.get('/:siteId/products', asyncHandler(controller.listProducts));
contentRoutes.post('/:siteId/products', asyncHandler(controller.createProduct));

contentRoutes.get('/:siteId/products/:productId', asyncHandler(controller.getProduct));
contentRoutes.patch('/:siteId/products/:productId', asyncHandler(controller.updateProduct));
contentRoutes.delete('/:siteId/products/:productId', asyncHandler(controller.deleteProduct));
