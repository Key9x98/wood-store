import { prisma } from '../../db/prisma';
import { UserRepository } from './users.repository';
import { UserService } from './users.service';

export const userRepository = new UserRepository(prisma);
export const usersService = new UserService(userRepository);
