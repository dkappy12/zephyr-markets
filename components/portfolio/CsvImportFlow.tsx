"use client";

import type { ClassifiedPosition } from "@/lib/portfolio/book";
import Papa from "papaparse";
import { useCallback, useState } from "react";
import * as XLSX from "xlsx";

type Props = {
  open: boolean;
  onClose: () => void;
  onClassified: (payload: {
    headers: string[];
    rows: Record<string, unknown>[];
    classified: ClassifiedPosition[];
  }) => void;
};

export function CsvImportFlow({ open, onClose, onClassified }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [fallbackChunks, setFallbackChunks] = useState(0);

  const runClassify = useCallback(
    async (headers: string[], rows: Record<string, unknown>[]) => {
      setLoading(true);
      setError(null);
      try {
        if (rows.length === 0) {
          setError("No data rows found in file");
          setLoading(false);
          return;
        }
        const slice = rows.slice(0, 200);
        const chunkSize = 40;
        const classifiedAll: ClassifiedPosition[] = [];
        setProgress({ done: 0, total: slice.length });
        setFallbackChunks(0);

        for (let i = 0; i < slice.length; i += chunkSize) {
          const chunk = slice.slice(i, i + chunkSize);
          const res = await fetch("/api/classify-positions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ headers, rows: chunk }),
          });
          const data = (await res.json()) as {
            classified?: ClassifiedPosition[];
            error?: string;
            detail?: string;
            code?: string;
            mode?: "model" | "fallback";
          };
          if (!res.ok) {
            throw new Error(mapClassifyError(data.code, data.error ?? data.detail));
          }
          if (!data.classified || !Array.isArray(data.classified)) {
            throw new Error("Invalid response");
          }
          classifiedAll.push(...data.classified);
          if (data.mode === "fallback") {
            setFallbackChunks((prev) => prev + 1);
          }
          setProgress({
            done: Math.min(i + chunk.length, slice.length),
            total: slice.length,
          });
        }
        onClassified({ headers, rows: slice, classified: classifiedAll });
        onClose();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setProgress({ done: 0, total: 0 });
        setFallbackChunks(0);
        setLoading(false);
      }
    },
    [onClassified, onClose],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      const name = file.name.toLowerCase();
      try {
        if (name.endsWith(".csv")) {
          const text = await file.text();
          Papa.parse<Record<string, unknown>>(text, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              const rows = results.data.filter(
                (r) => Object.keys(r).some((k) => String(r[k] ?? "").trim() !== ""),
              );
              const headers = results.meta.fields ?? Object.keys(rows[0] ?? {});
              void runClassify(headers, rows);
            },
            error: (err: { message: string }) => {
              setLoading(false);
              setError(err.message);
            },
          });
          return;
        }
        if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]!];
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
            defval: "",
          });
          const headers =
            rows.length > 0 ? Object.keys(rows[0]!) : [];
          await runClassify(headers, rows);
          return;
        }
        setLoading(false);
        setError("Please upload a .csv or .xlsx file");
      } catch (e: unknown) {
        setLoading(false);
        setError(e instanceof Error ? e.message : "Could not read file");
      }
    },
    [runClassify],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/25 px-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-import-title"
    >
      <div className="relative w-full max-w-lg rounded-[6px] border border-[#D4CCBB] bg-[#F5F0E8] p-6 shadow-lg">
        <button
          type="button"
          onClick={() => !loading && onClose()}
          className="absolute right-4 top-4 text-[11px] uppercase tracking-[0.1em] text-ink-mid hover:text-ink"
        >
          Close
        </button>
        <h2
          id="csv-import-title"
          className="font-serif text-xl text-ink"
        >
          Import positions
        </h2>
        <p className="mt-1 text-xs text-ink-mid">
          CSV or Excel from Trayport, ICE, Bloomberg, Marex, or any broker export.
        </p>
        <label
          className={`mt-6 flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-[6px] border border-dashed border-[#D4CCBB] bg-card/80 px-4 py-8 text-center transition-colors ${
            drag ? "border-[#1D6B4E] bg-ivory-dark/50" : "hover:bg-ivory-dark/30"
          } ${loading ? "pointer-events-none opacity-60" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) void handleFile(f);
          }}
        >
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            disabled={loading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <div
                className="h-8 w-8 animate-spin rounded-full border-2 border-[#D4CCBB] border-t-[#1D6B4E]"
                aria-hidden
              />
              <p className="text-sm text-ink">Analysing your positions…</p>
              {progress.total > 0 ? (
                <div className="w-56">
                  <div className="h-2 w-full overflow-hidden rounded-sm bg-ivory-border/60">
                    <div
                      className="h-full rounded-sm bg-[#1D6B4E]"
                      style={{
                        width: `${Math.round((progress.done / progress.total) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-ink-light">
                    {progress.done}/{progress.total} rows classified
                  </p>
                  {fallbackChunks > 0 ? (
                    <p className="mt-1 text-[11px] text-[#8B3A3A]">
                      Resilience mode used on {fallbackChunks} chunk
                      {fallbackChunks === 1 ? "" : "s"}.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <p className="text-sm font-medium text-ink">
                Drop a file here or click to browse
              </p>
              <p className="mt-2 text-[11px] text-ink-light">
                .csv and .xlsx · up to 200 rows per import
              </p>
            </>
          )}
        </label>
        {error ? (
          <p className="mt-3 text-xs text-[#8B3A3A]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

function mapClassifyError(code?: string, message?: string): string {
  if (code === "RATE_LIMITED") {
    return "Import rate limit reached. Please wait a minute and retry.";
  }
  if (code === "UNAUTHORIZED") {
    return "Your session expired. Please sign in again.";
  }
  return message ?? "Classification failed";
}
