import { useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Palette, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { getSite } from '@/lib/api/sites';
import {
  bulkImportProducts,
  createProduct,
  deleteProduct,
  listProducts,
  resyncSite,
  type ProductInput,
} from '@/lib/api/content';
import { switchTemplate } from '@/lib/api/deploy';
import { listTemplates } from '@/lib/api/templates';
import { apiErrorMessage } from '@/lib/api';
import type { Site, SiteProduct, Template } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

const vnd = (n: number): string => `${n.toLocaleString('vi-VN')} ₫`;

const siteStatusVariant: Record<Site['status'], BadgeProps['variant']> = {
  queued: 'secondary',
  provisioning: 'warning',
  active: 'success',
  failed: 'destructive',
  ssl_failed: 'destructive',
  deleted: 'outline',
};

const syncVariant: Record<SiteProduct['syncStatus'], BadgeProps['variant']> = {
  pending: 'secondary',
  syncing: 'warning',
  synced: 'success',
  failed: 'destructive',
};

export function SiteDetailPage() {
  const params = useParams<{ siteId: string }>();
  const siteId = Number(params.siteId);
  const qc = useQueryClient();

  const [openCreate, setOpenCreate] = useState(false);
  const [openBulk, setOpenBulk] = useState(false);
  const [openSwitch, setOpenSwitch] = useState(false);
  const [deleting, setDeleting] = useState<SiteProduct | null>(null);

  const siteQ = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => getSite(siteId),
    enabled: Number.isInteger(siteId) && siteId > 0,
  });

  const productsQ = useQuery({
    queryKey: ['products', siteId],
    queryFn: () => listProducts(siteId, { limit: 100 }),
    enabled: Number.isInteger(siteId) && siteId > 0,
    // While anything is mid-sync, poll so the status badges settle on their own.
    refetchInterval: (query) => {
      const items = query.state.data?.data ?? [];
      return items.some((p) => p.syncStatus === 'pending' || p.syncStatus === 'syncing')
        ? 3000
        : false;
    },
  });

  const templatesQ = useQuery({
    queryKey: ['templates', 'list'],
    queryFn: () => listTemplates({ limit: 100 }),
  });

  const invalidateProducts = () => qc.invalidateQueries({ queryKey: ['products', siteId] });

  const createMut = useMutation({
    mutationFn: (input: ProductInput) => createProduct(siteId, input),
    onSuccess: () => {
      toast.success('Đã thêm sản phẩm — đang đồng bộ xuống site');
      invalidateProducts();
      setOpenCreate(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const bulkMut = useMutation({
    mutationFn: (products: ProductInput[]) => bulkImportProducts(siteId, products),
    onSuccess: (r) => {
      toast.success(`Import xong: +${r.created} mới, ${r.updated} cập nhật`);
      invalidateProducts();
      setOpenBulk(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (productId: number) => deleteProduct(siteId, productId),
    onSuccess: () => {
      toast.success('Đã xoá sản phẩm');
      invalidateProducts();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const resyncMut = useMutation({
    mutationFn: () => resyncSite(siteId),
    onSuccess: (r) => {
      toast.success(`Đã xếp hàng đồng bộ lại (job #${r.jobId})`);
      invalidateProducts();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const switchMut = useMutation({
    mutationFn: (templateId: number) => switchTemplate(siteId, templateId),
    onSuccess: (r) => {
      toast.success(`Đã xếp hàng deploy theme (job #${r.jobId})`);
      qc.invalidateQueries({ queryKey: ['site', siteId] });
      setOpenSwitch(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (!Number.isInteger(siteId) || siteId <= 0) {
    return <Navigate to="/sites" replace />;
  }

  const site = siteQ.data;
  const products = productsQ.data?.data ?? [];
  const templates = templatesQ.data?.data ?? [];
  const currentTemplate = templates.find((t) => t.id === site?.templateId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/sites"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Sites
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {site?.domain ?? `Site #${siteId}`}
            </h1>
            {site && <Badge variant={siteStatusVariant[site.status]}>{site.status}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Quản lý sản phẩm của site — dữ liệu lưu ở CMS rồi đồng bộ xuống WordPress.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOpenSwitch(true)}>
            <Palette className="h-4 w-4" /> Áp dụng template
          </Button>
          <Button
            variant="outline"
            onClick={() => resyncMut.mutate()}
            disabled={resyncMut.isPending}
          >
            {resyncMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Đồng bộ lại
          </Button>
          <Button variant="outline" onClick={() => setOpenBulk(true)}>
            <Upload className="h-4 w-4" /> Import hàng loạt
          </Button>
          <Button onClick={() => setOpenCreate(true)}>
            <Plus className="h-4 w-4" /> Thêm sản phẩm
          </Button>
        </div>
      </div>

      {site && (
        <Card className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
          <Info label="Site ID" value={`#${site.id}`} />
          <Info
            label="Template"
            value={currentTemplate ? currentTemplate.name : `#${site.templateId}`}
          />
          <Info
            label="Provisioned"
            value={site.provisionedAt ? format(new Date(site.provisionedAt), 'yyyy-MM-dd HH:mm') : '—'}
          />
          <Info label="Sản phẩm" value={String(productsQ.data?.total ?? products.length)} />
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">ID</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Tên</TableHead>
              <TableHead>Giá</TableHead>
              <TableHead>Đồng bộ</TableHead>
              <TableHead>WP Post</TableHead>
              <TableHead className="w-20 text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {productsQ.isLoading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!productsQ.isLoading && products.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Chưa có sản phẩm — bấm “Thêm sản phẩm” hoặc “Import hàng loạt”.
                </TableCell>
              </TableRow>
            )}
            {products.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono">{p.id}</TableCell>
                <TableCell className="font-mono text-xs">{p.slug}</TableCell>
                <TableCell className="font-medium">
                  {p.name}
                  {p.featured && (
                    <Badge variant="outline" className="ml-2">
                      nổi bật
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {p.salePrice ? (
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{vnd(p.salePrice)}</span>
                      <span className="text-xs text-muted-foreground line-through">
                        {vnd(p.regularPrice)}
                      </span>
                      <Badge variant="success">-{p.salePercent}%</Badge>
                    </span>
                  ) : (
                    <span className="font-medium">{vnd(p.regularPrice)}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={syncVariant[p.syncStatus]}
                    title={p.syncError ?? undefined}
                  >
                    {p.syncStatus}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {p.wpPostId ? `#${p.wpPostId}` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setDeleting(p)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ProductFormDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        onSubmit={(v) => createMut.mutate(v)}
        submitting={createMut.isPending}
      />

      <BulkImportDialog
        open={openBulk}
        onOpenChange={setOpenBulk}
        onSubmit={(v) => bulkMut.mutate(v)}
        submitting={bulkMut.isPending}
      />

      <SwitchTemplateDialog
        open={openSwitch}
        onOpenChange={setOpenSwitch}
        templates={templates}
        currentTemplateId={site?.templateId}
        onSubmit={(templateId) => switchMut.mutate(templateId)}
        submitting={switchMut.isPending}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Xoá sản phẩm “${deleting?.name}”?`}
        description="Sản phẩm được archive ở CMS và trash trên WordPress (có thể khôi phục)."
        destructive
        confirmLabel="Xoá"
        onConfirm={async () => {
          if (deleting) await deleteMut.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

// ---- Single product form ----------------------------------------------------

const productSchema = z
  .object({
    name: z.string().min(2, 'Tên ≥ 2 ký tự'),
    shortDescription: z.string().max(500).optional(),
    description: z.string().min(1, 'Bắt buộc nhập mô tả'),
    regularPrice: z.string().regex(/^\d+$/, 'Giá gốc là số nguyên (VND)'),
    salePrice: z.string().regex(/^\d*$/, 'Giá sale là số'),
    wood: z.string().optional(),
    categoriesCsv: z.string().optional(),
    imagesText: z.string().optional(),
    featured: z.boolean(),
  })
  .refine((d) => !d.salePrice || Number(d.salePrice) < Number(d.regularPrice), {
    message: 'Giá sale phải nhỏ hơn giá gốc',
    path: ['salePrice'],
  });
type ProductForm = z.infer<typeof productSchema>;

function formToInput(v: ProductForm): ProductInput {
  const categories = (v.categoriesCsv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const images = (v.imagesText ?? '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const attributes: Record<string, unknown> = {};
  if (v.wood?.trim()) attributes.wood = v.wood.trim();
  return {
    name: v.name.trim(),
    description: v.description,
    shortDescription: v.shortDescription?.trim() || undefined,
    regularPrice: Number(v.regularPrice),
    salePrice: v.salePrice ? Number(v.salePrice) : undefined,
    featured: v.featured || undefined,
    categories: categories.length ? categories : undefined,
    images: images.length ? images : undefined,
    attributes: Object.keys(attributes).length ? attributes : undefined,
  };
}

function ProductFormDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (v: ProductInput) => void;
  submitting: boolean;
}) {
  const form = useForm<ProductForm>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      shortDescription: '',
      description: '',
      regularPrice: '',
      salePrice: '',
      wood: '',
      categoriesCsv: '',
      imagesText: '',
      featured: false,
    },
  });
  const err = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) form.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Thêm sản phẩm</DialogTitle>
          <DialogDescription>
            Lưu vào CMS rồi tự động đồng bộ xuống WordPress. Slug sinh tự động từ tên.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((v) => onSubmit(formToInput(v)))}
          className="space-y-4"
        >
          <Field label="Tên sản phẩm" error={err.name?.message}>
            <Input placeholder="Tủ thờ gỗ Hương" {...form.register('name')} />
          </Field>
          <Field label="Mô tả ngắn" error={err.shortDescription?.message}>
            <Input placeholder="Tóm tắt 1 dòng" {...form.register('shortDescription')} />
          </Field>
          <Field label="Mô tả chi tiết" error={err.description?.message}>
            <Textarea rows={3} placeholder="Mô tả đầy đủ..." {...form.register('description')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Giá gốc (VND)" error={err.regularPrice?.message}>
              <Input inputMode="numeric" placeholder="12500000" {...form.register('regularPrice')} />
            </Field>
            <Field label="Giá sale (VND)" error={err.salePrice?.message}>
              <Input inputMode="numeric" placeholder="(để trống nếu không)" {...form.register('salePrice')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Chất liệu gỗ" error={err.wood?.message}>
              <Input placeholder="Gỗ Hương" {...form.register('wood')} />
            </Field>
            <Field label="Danh mục (slug, phẩy)" error={err.categoriesCsv?.message}>
              <Input placeholder="tu-tho, do-tho" {...form.register('categoriesCsv')} />
            </Field>
          </div>
          <Field
            label="Ảnh / Video / YouTube (mỗi URL một dòng)"
            error={err.imagesText?.message}
          >
            <Textarea
              rows={4}
              placeholder={
                'https://cdn/.../anh.jpg\n' +
                'https://cdn/.../video.mp4\n' +
                'https://youtu.be/dQw4w9WgXcQ'
              }
              {...form.register('imagesText')}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Hỗ trợ ảnh JPG/PNG/WebP, video MP4/WebM/MOV, hoặc link YouTube
              (watch/youtu.be/shorts). Ảnh đầu tiên dùng làm thumbnail sản phẩm.
            </p>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" {...form.register('featured')} />
            Sản phẩm nổi bật
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Thêm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ---- Bulk import ------------------------------------------------------------

const BULK_PLACEHOLDER = `[
  {
    "name": "Bàn ăn gỗ Sồi 6 ghế",
    "description": "Bàn ăn gỗ sồi tự nhiên, mặt dày 25mm.",
    "regularPrice": 9500000,
    "salePrice": 8200000,
    "categories": ["ban-an"],
    "attributes": { "wood": "Gỗ Sồi" }
  }
]`;

function parseBulk(text: string): { items: ProductInput[] } | { error: string } | null {
  if (!text.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'JSON không hợp lệ' };
  }
  if (!Array.isArray(value)) return { error: 'JSON phải là một mảng sản phẩm' };
  if (value.length === 0) return { error: 'Mảng rỗng' };
  if (value.length > 500) return { error: 'Tối đa 500 sản phẩm mỗi lần' };
  return { items: value as ProductInput[] };
}

function BulkImportDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (v: ProductInput[]) => void;
  submitting: boolean;
}) {
  const [text, setText] = useState('');
  const parsed = parseBulk(text);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setText('');
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import sản phẩm hàng loạt</DialogTitle>
          <DialogDescription>
            Dán một mảng JSON các sản phẩm. Trùng slug sẽ được cập nhật (idempotent).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            rows={14}
            className="font-mono text-xs"
            placeholder={BULK_PLACEHOLDER}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {parsed && 'error' in parsed && (
            <p className="text-xs text-destructive">{parsed.error}</p>
          )}
          {parsed && 'items' in parsed && (
            <p className="text-xs text-muted-foreground">
              {parsed.items.length} sản phẩm sẵn sàng import.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button
            disabled={submitting || !parsed || 'error' in parsed}
            onClick={() => parsed && 'items' in parsed && onSubmit(parsed.items)}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Switch template --------------------------------------------------------

function SwitchTemplateDialog({
  open,
  onOpenChange,
  templates,
  currentTemplateId,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templates: Template[];
  currentTemplateId?: number;
  onSubmit: (templateId: number) => void;
  submitting: boolean;
}) {
  const [selected, setSelected] = useState('');
  const ready = templates.filter((t) => t.status === 'ready');
  const selectedId = selected ? Number(selected) : null;
  const isSame = selectedId !== null && selectedId === currentTemplateId;
  const isDifferent = selectedId !== null && selectedId !== currentTemplateId;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSelected('');
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Áp dụng template</DialogTitle>
          <DialogDescription>
            Chọn lại template hiện tại = đẩy lại file theme (sau khi sửa code).
            Chọn template khác = đổi giao diện cho site. Sản phẩm trong CMS không
            bị ảnh hưởng.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Template</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger>
              <SelectValue placeholder="Chọn template" />
            </SelectTrigger>
            <SelectContent>
              {ready.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name} ({t.slug}){t.id === currentTemplateId ? ' — đang dùng' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {ready.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Chưa có template nào ở trạng thái “ready”.
            </p>
          )}
          {isSame && (
            <p className="text-xs text-muted-foreground">
              → Sẽ chỉ đẩy lại file theme (không đổi template).
            </p>
          )}
          {isDifferent && (
            <p className="text-xs text-muted-foreground">
              → Sẽ đổi template + deploy theme mới.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button
            disabled={submitting || !selected}
            onClick={() => selected && onSubmit(Number(selected))}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Áp dụng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
