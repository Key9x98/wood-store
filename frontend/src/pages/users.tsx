import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  type CreateUserInput,
  type UpdateUserInput,
} from '@/lib/api/users';
import { apiErrorMessage } from '@/lib/api';
import type { Role, User } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/confirm-dialog';

const roleEnum = z.enum(['admin', 'user', 'system']);

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Tối thiểu 8 ký tự').max(128),
  role: roleEnum,
});
type CreateForm = z.infer<typeof createSchema>;

const updateSchema = z.object({
  email: z.string().email().optional().or(z.literal('')),
  password: z.string().min(8).max(128).optional().or(z.literal('')),
  role: roleEnum,
});
type UpdateForm = z.infer<typeof updateSchema>;

export function UsersPage() {
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users', 'list'],
    queryFn: () => listUsers({ limit: 100 }),
  });

  const createMut = useMutation({
    mutationFn: (input: CreateUserInput) => createUser(input),
    onSuccess: () => {
      toast.success('Đã tạo user');
      qc.invalidateQueries({ queryKey: ['users'] });
      setOpenCreate(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateUserInput }) => updateUser(id, input),
    onSuccess: () => {
      toast.success('Đã cập nhật');
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditing(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: () => {
      toast.success('Đã xóa user');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">Quản lý tài khoản truy cập CMS.</p>
        </div>
        <Button onClick={() => setOpenCreate(true)}>
          <Plus className="h-4 w-4" /> Tạo user
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">ID</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Tạo lúc</TableHead>
              <TableHead className="w-32 text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Chưa có user
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono">{u.id}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(u.createdAt), 'yyyy-MM-dd HH:mm')}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(u)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleting(u)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <CreateUserDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        onSubmit={(v) => createMut.mutate(v)}
        submitting={createMut.isPending}
      />

      <EditUserDialog
        user={editing}
        onClose={() => setEditing(null)}
        onSubmit={(v) =>
          editing &&
          updateMut.mutate({
            id: editing.id,
            input: {
              ...(v.email ? { email: v.email } : {}),
              ...(v.password ? { password: v.password } : {}),
              role: v.role,
            },
          })
        }
        submitting={updateMut.isPending}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Xóa user ${deleting?.email}?`}
        description="Hành động này không thể hoàn tác."
        destructive
        confirmLabel="Xóa"
        onConfirm={async () => {
          if (deleting) await deleteMut.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (v: CreateForm) => void;
  submitting: boolean;
}) {
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { email: '', password: '', role: 'user' },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) form.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo user mới</DialogTitle>
          <DialogDescription>Thêm tài khoản truy cập admin/user/system.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="c-email">Email</Label>
            <Input id="c-email" type="email" {...form.register('email')} />
            {form.formState.errors.email && (
              <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-password">Password</Label>
            <Input id="c-password" type="password" {...form.register('password')} />
            {form.formState.errors.password && (
              <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select
              value={form.watch('role')}
              onValueChange={(v) => form.setValue('role', v as Role)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="user">user</SelectItem>
                <SelectItem value="system">system</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Tạo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSubmit,
  submitting,
}: {
  user: User | null;
  onClose: () => void;
  onSubmit: (v: UpdateForm) => void;
  submitting: boolean;
}) {
  const form = useForm<UpdateForm>({
    resolver: zodResolver(updateSchema),
    values: user
      ? { email: user.email, password: '', role: user.role }
      : { email: '', password: '', role: 'user' },
  });

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sửa user #{user?.id}</DialogTitle>
          <DialogDescription>Để trống password nếu không đổi.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="e-email">Email</Label>
            <Input id="e-email" type="email" {...form.register('email')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-password">Password mới</Label>
            <Input id="e-password" type="password" {...form.register('password')} />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select
              value={form.watch('role')}
              onValueChange={(v) => form.setValue('role', v as Role)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="user">user</SelectItem>
                <SelectItem value="system">system</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Lưu
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
