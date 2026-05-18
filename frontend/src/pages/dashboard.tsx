import { useQueries } from '@tanstack/react-query';
import { Globe2, PackageOpen, Users2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { listUsers } from '@/lib/api/users';
import { listSites } from '@/lib/api/sites';
import { listTemplates } from '@/lib/api/templates';
import { useAuth } from '@/store/auth';

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [usersQ, sitesQ, templatesQ] = useQueries({
    queries: [
      {
        queryKey: ['users', 'count'],
        queryFn: () => listUsers({ limit: 1 }),
        enabled: isAdmin,
      },
      { queryKey: ['sites', 'count'], queryFn: () => listSites({ limit: 1 }) },
      { queryKey: ['templates', 'count'], queryFn: () => listTemplates({ limit: 1 }) },
    ],
  });

  const stats = [
    { label: 'Users', value: usersQ.data?.total, icon: Users2, enabled: isAdmin, q: usersQ },
    { label: 'Sites', value: sitesQ.data?.total, icon: Globe2, enabled: true, q: sitesQ },
    {
      label: 'Templates',
      value: templatesQ.data?.total,
      icon: PackageOpen,
      enabled: true,
      q: templatesQ,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Tổng quan hệ thống multi-tenant auto website builder.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {stats
          .filter((s) => s.enabled)
          .map((s) => (
            <Card key={s.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {s.q.isLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : s.q.isError ? (
                  <p className="text-sm text-destructive">Lỗi tải</p>
                ) : (
                  <div className="text-3xl font-bold">{s.value ?? 0}</div>
                )}
              </CardContent>
            </Card>
          ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Phiên đăng nhập
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Email:</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Role:</span>
            <Badge variant={user?.role === 'admin' ? 'default' : 'secondary'}>{user?.role}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">User ID:</span>
            <span className="font-mono text-xs">{user?.id}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
