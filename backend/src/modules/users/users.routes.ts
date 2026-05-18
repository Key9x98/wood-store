import { Router } from 'express';
import { authRequired, role } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../lib/async-handler';
import * as controller from './users.controller';

export const usersRoutes = Router();

usersRoutes.use(authRequired, role('admin'));

usersRoutes.get('/', asyncHandler(controller.listUsers));
usersRoutes.post('/', asyncHandler(controller.createUser));
usersRoutes.get('/:id', asyncHandler(controller.getUser));
usersRoutes.patch('/:id', asyncHandler(controller.updateUser));
usersRoutes.delete('/:id', asyncHandler(controller.deleteUser));
