"use client";

import type { PositionRow } from "@/lib/portfolio/book";
import { tenorToExpiryDate } from "@/lib/portfolio/book";
import { getTradePriceBounds } from "@/lib/portfolio/position-contract";
import { useEffect, useMemo, useState } from "react";

const INSTRUMENTS = [
  {
    label: "GB Power Forward",
    instrument_type: "power_forward",
    market: "GB_power",
    currency: "GBP",
  },
  {
    label: "NBP Gas Forward",
    instrument_type: "gas_forward",
    market: "NBP",
    currency: "GBP",
  },
  {
    label: "TTF Gas Forward",
    instrument_type: "gas_forward",
    market: "TTF",
    currency: "EUR",
  },
  {
    label: "UK Carbon (UKA)",
    instrument_type: "carbon",
    market: "UKA",
    currency: "GBP",
  },
  {
    label: "EU Carbon (EUA)",
    instrument_type: "carbon",
    market: "EUA",
    currency: "EUR",
  },
  { label: "Spark Spread", instrument_type: "spark_spread", market: "GB_power", currency: "GBP" },
  { label: "Dark Spread", instrument_type: "dark_spread", market: "GB_power", currency: "GBP" },
  {
    label: "Nordic Power",
    instrument_type: "power_forward",
    market: "nordic_power",
    currency: "EUR",
  },
  {
    label: "German Power",
    instrument_type: "power_forward",
    market: "german_power",
    currency: "EUR",
  },
  {
    label: "French Power",
    instrument_type: "power_forward",
    market: "french_power",
    currency: "EUR",
  },
  {
    label: "Other Energy",
    instrument_type: "other_energy",
    market: "other_power",
    currency: "GBP",
  },
] as const;

const UNITS = ["MW", "MWh", "therms", "tCO2", "lots"] as const;

function buildTenorOptions(): string[] {
  const y = new Date().getUTCFullYear();
  const out: string[] = [
    "Spot",
    "Day-ahead",
    "Balance of month",
    "Month+1",
  ];
  for (let yr = y; yr <= y + 3; yr++) {
    out.push(`Q1 ${yr}`, `Q2 ${yr}`, `Q3 ${yr}`, `Q4 ${yr}`);
    out.push(`Win ${yr}-${String(yr + 1).slice(-2)}`, `Sum ${yr}`);
    out.push(`Cal ${yr}`);
  }
  return out;
}

type Props = {
  open: boolean;
  onClose: () => void;
  editPosition: PositionRow | null;
  onSaved: () => void;
  onToast: (message: string, type: "ok" | "err") => void;
};

export function QuickAddModal({
  open,
  onClose,
  editPosition,
  onSaved,
  onToast,
}: Props) {
  const [instrumentIdx, setInstrumentIdx] = useState(0);
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [size, setSize] = useState("");
  const [unit, setUnit] = useState<(typeof UNITS)[number]>("MW");
  const [tenor, setTenor] = useState("Month+1");
  const [tradePrice, setTradePrice] = useState("");
  const [entryDate, setEntryDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [instrumentName, setInstrumentName] = useState("");
  const [saving, setSaving] = useState(false);

  const tenorOptions = useMemo(() => buildTenorOptions(), []);
  const priceUnitLabel = useMemo(() => {
    const s = INSTRUMENTS[instrumentIdx]!;
    return getTradePriceBounds(s.instrument_type, s.market).unitLabel;
  }, [instrumentIdx]);
  const tenorChoices = useMemo(() => {
    if (tenor && !tenorOptions.includes(tenor)) {
      return [tenor, ...tenorOptions];
    }
    return tenorOptions;
  }, [tenor, tenorOptions]);

  useEffect(() => {
    if (!open) return;
    if (editPosition) {
      const idx = INSTRUMENTS.findIndex(
        (i) => i.market === editPosition.market && i.instrument_type === editPosition.instrument_type,
      );
      setInstrumentIdx(idx >= 0 ? idx : 0);
      setDirection(
        editPosition.direction === "short" ? "short" : "long",
      );
      setSize(editPosition.size != null ? String(editPosition.size) : "");
      setUnit(
        (UNITS.includes(editPosition.unit as (typeof UNITS)[number])
          ? editPosition.unit
          : "MW") as (typeof UNITS)[number],
      );
      setTenor(editPosition.tenor ?? "Month+1");
      setTradePrice(
        editPosition.trade_price != null ? String(editPosition.trade_price) : "",
      );
      setEntryDate(editPosition.entry_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
      setExpiryDate(editPosition.expiry_date?.slice(0, 10) ?? "");
      setNotes(editPosition.notes ?? "");
      setInstrumentName(
        editPosition.instrument?.trim()
          ? editPosition.instrument
          : INSTRUMENTS[idx >= 0 ? idx : 0]!.label,
      );
    } else {
      setInstrumentIdx(0);
      setDirection("long");
      setSize("");
      setUnit("MW");
      setTenor("Month+1");
      setTradePrice("");
      setEntryDate(new Date().toISOString().slice(0, 10));
      setExpiryDate("");
      setNotes("");
      setInstrumentName(INSTRUMENTS[0]!.label);
    }
  }, [open, editPosition]);

  if (!open) return null;

  const sel = INSTRUMENTS[instrumentIdx]!;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sz = Number(size);
    const tp = Number(tradePrice);
    if (!Number.isFinite(sz) || sz <= 0) {
      onToast("Size must be a positive number", "err");
      return;
    }
    if (!Number.isFinite(tp)) {
      onToast("Enter a valid trade price", "err");
      return;
    }
    const priceBounds = getTradePriceBounds(sel.instrument_type, sel.market);
    if (tp < priceBounds.min || tp > priceBounds.max) {
      onToast(
        `Trade price is outside the plausible range for ${sel.label} (${priceBounds.min} to ${priceBounds.max} ${priceBounds.unitLabel})`,
        "err",
      );
      return;
    }
    if (!tenor.trim()) {
      onToast("Select a tenor", "err");
      return;
    }
    setSaving(true);
    try {
      const expiryFromTenor =
        expiryDate.trim().length > 0 ? null : tenorToExpiryDate(tenor);
      const payload = {
        instrument: instrumentName.trim() || sel.label,
        instrument_type: sel.instrument_type,
        market: sel.market,
        direction,
        size: sz,
        unit: unit.toLowerCase() === "therms" ? "therm" : unit.toLowerCase(),
        tenor,
        trade_price: tp,
        currency: sel.currency,
        entry_date: entryDate,
        expiry_date: expiryDate || expiryFromTenor || null,
        notes: notes.trim() || null,
        source: "manual",
        is_hypothetical: false,
        is_closed: false,
      };
      if (editPosition) {
        const resp = await fetch(`/api/portfolio/positions/${editPosition.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        if (!resp.ok) throw new Error(body.error ?? "Update failed");
        onToast("Position updated", "ok");
      } else {
        const resp = await fetch("/api/portfolio/positions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        if (!resp.ok) throw new Error(body.error ?? "Create failed");
        onToast("Position added", "ok");
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Save failed", "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/25 px-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[6px] border border-[#D4CCBB] bg-[#F5F0E8] p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-serif text-xl text-ink">
            {editPosition ? "Edit position" : "Add position"}
          </h2>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="text-[11px] uppercase tracking-[0.1em] text-ink-mid hover:text-ink"
          >
            Close
          </button>
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
              Instrument type
            </span>
            <select
              value={instrumentIdx}
              onChange={(e) => {
                const i = Number(e.target.value);
                setInstrumentIdx(i);
                if (!editPosition) {
                  setInstrumentName(INSTRUMENTS[i]!.label);
                }
              }}
              className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-3 py-2 text-sm text-ink"
            >
              {INSTRUMENTS.map((opt, i) => (
                <option key={opt.label} value={i}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
              Market
            </span>
            <p className="mt-1 rounded-[4px] border border-dashed border-ivory-border bg-ivory-dark/20 px-3 py-2 text-sm text-ink-mid">
              {sel.market.replace(/_/g, " ")}
            </p>
          </div>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
              Instrument name
            </span>
            <input
              type="text"
              value={instrumentName}
              onChange={(e) => setInstrumentName(e.target.value)}
              className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-3 py-2 text-sm text-ink"
              placeholder={sel.label}
            />
          </label>
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
              Direction
            </span>
            <div className="mt-1 flex gap-2">
              {(["long", "short"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={`flex-1 rounded-[4px] border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                    direction === d
                      ? "border-[#1D6B4E] bg-[#1D6B4E]/10 text-[#1D6B4E]"
                      : "border-[#D4CCBB] bg-card text-ink-mid hover:bg-ivory-dark/40"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                Size
              </span>
              <input
                type="number"
                step="any"
                min="0"
                required
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="w-28">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                Unit
              </span>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as (typeof UNITS)[number])}
                className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-2 py-2 text-sm text-ink"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
              Tenor
            </span>
            <select
              value={tenorChoices.includes(tenor) ? tenor : tenorChoices[0]!}
              onChange={(e) => setTenor(e.target.value)}
              className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-3 py-2 text-sm text-ink"
            >
              {tenorChoices.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
              Trade price ({priceUnitLabel})
            </span>
            <input
              type="number"
              step="any"
              required
              value={tradePrice}
              onChange={(e) => setTradePrice(e.target.value)}
              className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-3 py-2 text-sm text-ink"
            />
          </label>
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                Entry date
              </span>
              <input
                type="date"
                required
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                Expiry date
              </span>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-3 py-2 text-sm text-ink"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
              Notes (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-[4px] border border-[#D4CCBB] bg-card px-3 py-2 text-sm text-ink"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => !saving && onClose()}
              className="rounded-[4px] border border-[#D4CCBB] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-[4px] border border-ink bg-ink px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#FDFBF7] disabled:opacity-50"
            >
              {saving ? "Saving…" : editPosition ? "Save changes" : "Add position"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
