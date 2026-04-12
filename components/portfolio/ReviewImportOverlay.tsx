"use client";

import type { ClassifiedPosition } from "@/lib/portfolio/book";
import { marketBadge } from "@/lib/portfolio/book";

export type ReviewItem = ClassifiedPosition & { _key: string };

type Props = {
  open: boolean;
  keeping: ReviewItem[];
  discarding: ReviewItem[];
  onMoveToKeeping: (item: ReviewItem) => void;
  onRemoveKeeping: (key: string) => void;
  onImport: () => void;
  importing: boolean;
  onCancel: () => void;
};

export function ReviewImportOverlay({
  open,
  keeping,
  discarding,
  onMoveToKeeping,
  onRemoveKeeping,
  onImport,
  importing,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#FDFBF7]">
      <header className="border-b border-[#D4CCBB] bg-[#F5F0E8] px-6 py-5">
        <h1 className="font-serif text-2xl text-ink">Review your positions</h1>
        <p className="mt-1 text-sm text-ink-mid">
          Zephyr has classified your CSV. Confirm what to import.
        </p>
      </header>
      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 md:grid-cols-2 md:p-6">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[6px] border border-[#D4CCBB] bg-card">
          <p className="border-b border-ivory-border px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
            Importing ({keeping.length} positions)
          </p>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {keeping.length === 0 ? (
              <p className="text-sm text-ink-light">No positions selected.</p>
            ) : (
              keeping.map((item) => (
                <div
                  key={item._key}
                  className="relative rounded-[6px] border border-[#D4CCBB] bg-ivory/40 p-4 pr-10"
                >
                  <button
                    type="button"
                    onClick={() => onRemoveKeeping(item._key)}
                    className="absolute right-2 top-2 text-[11px] text-ink-mid hover:text-[#8B3A3A]"
                    aria-label="Remove"
                  >
                    ✕ Remove
                  </button>
                  <p className="pr-6 font-semibold text-ink">
                    {item.instrument ?? "Instrument"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        item.direction === "short"
                          ? "bg-[#8B3A3A]/15 text-[#8B3A3A]"
                          : "bg-[#1D6B4E]/15 text-[#1D6B4E]"
                      }`}
                    >
                      {item.direction === "short" ? "SHORT" : "LONG"}
                    </span>
                    <span className="text-xs tabular-nums text-ink-mid">
                      {item.size ?? "—"} {item.unit ?? ""}
                    </span>
                    <span className="rounded border border-ivory-border px-2 py-0.5 text-[10px] uppercase text-ink-mid">
                      {marketBadge(item.market)}
                    </span>
                  </div>
                  {item.tenor ? (
                    <p className="mt-2 text-xs text-ink-mid">Tenor: {item.tenor}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-mid">
                    {formatPriceHint(item)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[6px] border border-[#D4CCBB] bg-card opacity-95">
          <p className="border-b border-ivory-border px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
            Skipping ({discarding.length} rows)
          </p>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {discarding.map((item) => (
              <div
                key={item._key}
                className="rounded-[6px] border border-ivory-border bg-ivory-dark/30 p-4"
              >
                <p className="line-clamp-2 text-sm text-ink-mid">
                  {truncate(
                    String(item.instrument ?? JSON.stringify(item.original_row ?? {})),
                    120,
                  )}
                </p>
                <p className="mt-2 text-[11px] text-ink-light">
                  Reason: {item.discard_reason ?? "—"}
                </p>
                <button
                  type="button"
                  onClick={() => onMoveToKeeping(item)}
                  className="mt-2 text-[11px] font-medium text-[#1D6B4E] hover:underline"
                >
                  ← Keep this
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="px-6 text-center text-[11px] text-ink-light">
        Something classified incorrectly? Use the buttons to move positions between
        columns.
      </p>
      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-[#D4CCBB] bg-[#F5F0E8] px-6 py-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={importing}
          className="rounded-[4px] border border-[#D4CCBB] bg-transparent px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink hover:bg-ivory-dark/50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={importing || keeping.length === 0}
          onClick={() => onImport()}
          className="rounded-[4px] border border-ink bg-ink px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#FDFBF7] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {importing
            ? "Importing…"
            : `Import ${keeping.length} position${keeping.length === 1 ? "" : "s"} →`}
        </button>
      </footer>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

function formatPriceHint(item: ClassifiedPosition): string {
  const p = item.trade_price;
  if (p == null) return "—";
  const cur = item.currency ?? "GBP";
  if (cur === "GBP") return `@ £${p.toFixed(2)}/MWh`;
  if (item.unit === "therm" || item.market === "NBP") return `@ ${p.toFixed(2)}p/th`;
  return `@ ${p.toFixed(2)} ${cur}`;
}
