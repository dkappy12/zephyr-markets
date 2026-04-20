import type { CSSProperties } from "react";

/**
 * In-app morning brief “one risk” callout: green left rule + pale grey-green wash.
 * Opaque fill (not alpha-blended) so it cannot read as ivory-dark next to the terminal column.
 * Border + fill are inline so they are not dropped if Tailwind does not scan this file.
 */
export const briefOneRiskCalloutClassName = "rounded-[4px] pl-4";

export const briefOneRiskCalloutStyle: CSSProperties = {
  backgroundColor: "#F1F3EB",
  border: "0.5px solid #D9D2C4",
  borderLeft: "4px solid #1D6B4E",
};
