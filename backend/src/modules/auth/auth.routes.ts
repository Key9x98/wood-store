import { Router } from 'express';
import { authRateLimit } from '../../middleware/rate-limit.middleware';
import { asyncHandler } from '../../lib/async-handler';
import * as controller from './auth.controller';

export const authRoutes = Router();

authRoutes.post('/login', authRateLimit, asyncHandler(controller.login));
authRoutes.post('/refresh', authRateLimit, asyncHandler(controller.refresh));
