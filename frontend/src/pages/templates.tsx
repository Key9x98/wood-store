import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import {
  deleteTemplate,
  importTemplate,
  listTemplates,
  type ImportTemplateInput,
} from '@/lib/api/templates';
import { apiErrorMessage } from '@/lib/api';
import type { Template } from '@/lib/types';
import { useAuth } from '@/store/auth';
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
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/confirm-dialog';

const importSchema = z.object({
  slug: z
    .string()
    .toLowerCase()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, 'Slug không hợp lệ'),
  type: z.enum(['local', 'git', 'zip']),
  path: z.string().optional(),
  repo: z.string().optional(),
  ref: z.string().optional(),
});
type ImportForm = z.infer<typeof importSchema>;

const statusVariant: Record<Template['status'], BadgeProps['variant']> = {
  building: 'warning',
  ready: 'success',
  failed: 'destructive',
};

export function TemplatesPage() {
  const role = useAuth((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const qc = useQueryClient();
  const [openImport, setOpenImport] = useState(false);
  const [deleting, setDeleting] = useState<Template | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['templates', 'list'],
    queryFn: () => listTemplates({ limit: 100 }),
  });

  const importMut = useMutation({
    mutationFn: (input: ImportTemplateInput) => importTemplate(input),
    onSuccess: () => {
      toast.success('Đã import template');
      qc.invalidateQueries({ queryKey: ['templates'] });
      setOpenImport(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteTemplate(id),
    onSuccess: () => {
      toast.success('Đã xóa template');
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">
            Theme + DB dump + manifest dùng để provision site mới.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setOpenImport(true)}>
            <Plus className="h-4 w-4" /> Import template
          </Button>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">ID</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Tên</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tạo lúc</TableHead>
              {isAdmin && <TableHead className="w-20 text-right">Thao tác</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={isAdmin ? 7 : 6}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 7 : 6}
                  className="text-center text-muted-foreground"
                >
                  Chưa có template nào
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono">{t.id}</TableCell>
                <TableCell className="font-mono">{t.slug}</TableCell>
                <TableCell>{t.name}</TableCell>
                <TableCell className="font-mono text-xs">{t.version}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant[t.status]}>{t.status}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(t.createdAt), 'yyyy-MM-dd HH:mm')}
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(t)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ImportTemplateDialog
        open={openImport}
        onOpenChange={setOpenImport}
        onSubmit={(v) => importMut.mutate(v)}
        submitting={importMut.isPending}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Xóa template ${deleting?.slug}?`}
        description="Site đang dùng template này có thể bị ảnh hưởng."
        destructive
        confirmLabel="Xóa"
        onConfirm={async () => {
          if (deleting) await deleteMut.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}

function ImportTemplateDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (input: ImportTemplateInput) => void;
  submitting: boolean;
}) {
  const form = useForm<ImportForm>({
    resolver: zodResolver(importSchema),
    defaultValues: { slug: '', type: 'local', path: '', repo: '', ref: 'main' },
  });
  const type = form.watch('type');

  function submit(v: ImportForm) {
    const source: ImportTemplateInput['source'] =
      v.type === 'git'
        ? { type: 'git', repo: v.repo ?? '', ref: v.ref || 'main' }
        : { type: v.type, path: v.path ?? '' };
    onSubmit({ slug: v.slug, source });
  }

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
          <DialogTitle>Import template</DialogTitle>
          <DialogDescription>
            Nguồn local (đường dẫn server), Git repo, hoặc Zip archive.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" placeholder="my-template" {...form.register('slug')} />
            {form.formState.errors.slug && (
              <p className="text-xs text-destructive">{form.formState.errors.slug.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Loại nguồn</Label>
            <Select
              value={type}
              onValueChange={(v) => form.setValue('type', v as ImportForm['type'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">local (server path)</SelectItem>
                <SelectItem value="git">git</SelectItem>
                <SelectItem value="zip">zip (server path)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === 'git' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="repo">Git repo</Label>
                <Input
                  id="repo"
                  placeholder="https://github.com/org/template.git"
                  {...form.register('repo')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ref">Ref</Label>
                <Input id="ref" placeholder="main" {...form.register('ref')} />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="path">Path</Label>
              <Input
                id="path"
                placeholder="/var/templates/abc hoặc /tmp/file.zip"
                {...form.register('path')}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
