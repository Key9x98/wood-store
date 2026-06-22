import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface PaginationProps {
  offset: number;
  limit: number;
  total: number;
  onOffsetChange: (offset: number) => void;
  onLimitChange?: (limit: number) => void;
  pageSizeOptions?: number[];
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function Pagination({
  offset,
  limit,
  total,
  onOffsetChange,
  onLimitChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: PaginationProps) {
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const currentPage = Math.min(totalPages, Math.floor(offset / safeLimit) + 1);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + safeLimit, total);

  const goPrev = () => onOffsetChange(Math.max(0, offset - safeLimit));
  const goNext = () => onOffsetChange(offset + safeLimit);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <div className="text-muted-foreground">
        Hiển thị <span className="font-medium text-foreground">{from}–{to}</span> /{' '}
        <span className="font-medium text-foreground">{total}</span>
      </div>
      <div className="flex items-center gap-2">
        {onLimitChange && (
          <div className="mr-2 flex items-center gap-2 text-muted-foreground">
            <span>Mỗi trang</span>
            <Select
              value={String(safeLimit)}
              onValueChange={(v) => onLimitChange(Number(v))}
            >
              <SelectTrigger className="h-8 w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={goPrev}
          disabled={offset === 0}
          aria-label="Trang trước"
        >
          <ChevronLeft className="h-4 w-4" /> Trước
        </Button>
        <span className="text-muted-foreground">
          Trang <span className="font-medium text-foreground">{currentPage}</span> /{' '}
          {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={goNext}
          disabled={to >= total}
          aria-label="Trang sau"
        >
          Tiếp <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
