import type { CSSProperties } from "react";

/**
 * In-app morning brief “one risk” callout: green left rule + pale wash.
 * Border + fill are inline so they are not dropped if Tailwind does not scan this file.
 */
export const briefOneRiskCalloutClassName = "rounded-[4px] pl-4";

export const briefOneRiskCalloutStyle: CSSProperties = {
  backgroundColor: "rgba(29, 107, 78, 0.06)",
  borderLeft: "2px solid #1D6B4E",
};
