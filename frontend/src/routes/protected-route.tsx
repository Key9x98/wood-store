import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import type { Role } from '@/lib/types';

interface Props {
  children: ReactNode;
  role?: Role;
}

export function ProtectedRoute({ children, role }: Props) {
  const { accessToken, user } = useAuth();
  const location = useLocation();

  if (!accessToken || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (role && user.role !== role) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
