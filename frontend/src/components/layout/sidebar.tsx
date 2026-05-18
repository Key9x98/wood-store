import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Globe2, PackageOpen, Users2, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/sites', label: 'Sites', icon: Globe2 },
  { to: '/templates', label: 'Templates', icon: PackageOpen },
  { to: '/users', label: 'Users', icon: Users2, adminOnly: true },
];

export function Sidebar() {
  const role = useAuth((s) => s.user?.role);

  return (
    <aside className="hidden w-64 shrink-0 border-r bg-card md:flex md:flex-col">
      <div className="flex h-16 items-center border-b px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
            W
          </div>
          <span className="text-lg font-semibold">Wood CMS</span>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems
          .filter((item) => !item.adminOnly || role === 'admin')
          .map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
      </nav>
      <div className="border-t p-4 text-xs text-muted-foreground">
        v0.1 · {import.meta.env.MODE}
      </div>
    </aside>
  );
}
