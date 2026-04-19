import type { CSSProperties } from "react";

/**
 * Theme-aware defaults for Recharts <Tooltip />. Uses CSS variables from
 * globals.css so light / dark / system themes match the rest of the UI.
 */
export const rechartsTooltipContentStyle: CSSProperties = {
  background: "var(--card)",
  border: "0.5px solid var(--ivory-border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--ink)",
};

export const rechartsTooltipLabelStyle: CSSProperties = {
  color: "var(--ink-mid)",
  fontWeight: 500,
};

export const rechartsTooltipItemStyle: CSSProperties = {
  color: "var(--ink)",
};

/** Wrapper div for custom tooltip content (e.g. content={<ChartTooltip />}). */
export const chartTooltipBoxStyle: CSSProperties = {
  background: "var(--card)",
  border: "0.5px solid var(--ivory-border)",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 12,
  color: "var(--ink)",
};
