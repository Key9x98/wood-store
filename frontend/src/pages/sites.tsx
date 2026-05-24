import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { createSite, deleteSite, listSites, type CreateSiteInput } from '@/lib/api/sites';
import { listTemplates } from '@/lib/api/templates';
import { apiErrorMessage } from '@/lib/api';
import type { Site } from '@/lib/types';
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

const domainRegex = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/;

const createSchema = z.object({
  domain: z
    .string()
    .toLowerCase()
    .max(253)
    .regex(domainRegex, 'Domain không hợp lệ'),
  templateId: z.number().int().positive('Chọn template'),
});
type CreateForm = z.infer<typeof createSchema>;

const statusVariant: Record<Site['status'], BadgeProps['variant']> = {
  queued: 'secondary',
  provisioning: 'warning',
  active: 'success',
  failed: 'destructive',
  ssl_failed: 'destructive',
  deleted: 'outline',
};

export function SitesPage() {
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [deleting, setDeleting] = useState<Site | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sites', 'list'],
    queryFn: () => listSites({ limit: 100 }),
  });

  const templatesQ = useQuery({
    queryKey: ['templates', 'list', 'for-sites'],
    queryFn: () => listTemplates({ limit: 100 }),
  });

  const createMut = useMutation({
    mutationFn: (input: CreateSiteInput) => createSite(input),
    onSuccess: () => {
      toast.success('Đã tạo site');
      qc.invalidateQueries({ queryKey: ['sites'] });
      setOpenCreate(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteSite(id),
    onSuccess: () => {
      toast.success('Đã xóa site');
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const templates = templatesQ.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
          <p className="text-sm text-muted-foreground">
            Các website đang được provisioning / hoạt động.
          </p>
        </div>
        <Button onClick={() => setOpenCreate(true)} disabled={templates.length === 0}>
          <Plus className="h-4 w-4" /> Tạo site
        </Button>
      </div>

      {templates.length === 0 && !templatesQ.isLoading && (
        <Card className="p-4 text-sm text-muted-foreground">
          Chưa có template nào. Vào tab <strong>Templates</strong> để import trước khi tạo site.
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">ID</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Tạo lúc</TableHead>
              <TableHead className="w-20 text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Chưa có site nào
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono">{s.id}</TableCell>
                <TableCell className="font-medium">
                  <Link to={`/sites/${s.id}`} className="text-primary hover:underline">
                    {s.domain}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant[s.status]}>{s.status}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">#{s.templateId}</TableCell>
                <TableCell className="font-mono text-xs">#{s.ownerId}</TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(s.createdAt), 'yyyy-MM-dd HH:mm')}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setDeleting(s)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <CreateSiteDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        templates={templates}
        onSubmit={(v) => createMut.mutate(v)}
        submitting={createMut.isPending}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Xóa site ${deleting?.domain}?`}
        description="Site sẽ được đánh dấu deleted (không xóa vật lý ngay)."
        destructive
        confirmLabel="Xóa"
        onConfirm={async () => {
          if (deleting) await deleteMut.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}

function CreateSiteDialog({
  open,
  onOpenChange,
  templates,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templates: { id: number; name: string; slug: string; status: string }[];
  onSubmit: (v: CreateForm) => void;
  submitting: boolean;
}) {
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { domain: '', templateId: 0 },
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
          <DialogTitle>Tạo site mới</DialogTitle>
          <DialogDescription>
            Domain phải lowercase, ≥ 2 labels, không bắt đầu/kết thúc bằng dấu gạch ngang.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="domain">Domain</Label>
            <Input id="domain" placeholder="abc.com" {...form.register('domain')} />
            {form.formState.errors.domain && (
              <p className="text-xs text-destructive">{form.formState.errors.domain.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Template</Label>
            <Select
              value={form.watch('templateId') ? String(form.watch('templateId')) : ''}
              onValueChange={(v) => form.setValue('templateId', Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)} disabled={t.status !== 'ready'}>
                    {t.name} ({t.slug}) — {t.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.templateId && (
              <p className="text-xs text-destructive">
                {form.formState.errors.templateId.message}
              </p>
            )}
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
