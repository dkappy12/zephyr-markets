import type { CSSProperties } from "react";

/**
 * In-app morning brief “one risk” callout only (dashboard).
 * Green left rule + light wash — no full box outline (landing mock uses its own inline styles).
 */
export const briefOneRiskCalloutClassName = "rounded-[4px] pl-4";

export const briefOneRiskCalloutStyle: CSSProperties = {
  backgroundColor: "rgba(29, 107, 78, 0.03)",
  borderLeft: "2px solid #1D6B4E",
};
