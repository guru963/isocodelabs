import { ChevronLeft, ChevronRight } from "lucide-react";

/** Page numbers to show: always the first and last, the current page and its neighbours, gaps as null. */
function pageList(page: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  const keep = new Set([1, count, page - 1, page, page + 1].filter((n) => n >= 1 && n <= count));
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= count - 2) [count - 3, count - 2, count - 1].forEach((n) => keep.add(n));
  const sorted = [...keep].sort((a, b) => a - b);
  const list: (number | null)[] = [];
  sorted.forEach((n, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && n - previous > 1) list.push(null);
    list.push(n);
  });
  return list;
}

/** Previous and next, the page numbers between, and how many of how many are showing. */
export function Pager({
  page,
  pageSize,
  total,
  noun,
  label,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  label: string;
  onPage: (page: number) => void;
}) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <nav className="pager" aria-label={label}>
      <p className="pager-count" aria-live="polite">
        Showing <strong>{first}</strong>–<strong>{last}</strong> of <strong>{total}</strong> {noun}
      </p>
      {count > 1 && (
        <div className="pager-pages">
          <button
            type="button"
            className="pager-step"
            disabled={page === 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          {pageList(page, count).map((n, index) =>
            n === null ? (
              <span key={`gap-${index}`} className="pager-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                className="pager-page"
                aria-current={n === page ? "page" : undefined}
                aria-label={`Page ${n}`}
                onClick={() => onPage(n)}
              >
                {n}
              </button>
            ),
          )}
          <button
            type="button"
            className="pager-step"
            disabled={page === count}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  );
}
