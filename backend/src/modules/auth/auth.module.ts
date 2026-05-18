import { userRepository } from '../users/users.module';
import { AuthService } from './auth.service';

export const authService = new AuthService(userRepository);
