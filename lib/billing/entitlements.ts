export type TierCode = "free" | "pro" | "team" | "enterprise";

export type TierEntitlement = {
  code: TierCode;
  label: string;
  monthlyPriceGbp: number | null;
  realtimeSignals: boolean;
  signalDelayMinutes: number;
  portfolioEnabled: boolean;
  maxPositions: number | "unlimited";
  seats: number | "unlimited";
  dataExport: boolean;
  apiAccess: boolean;
};

export const TIER_ENTITLEMENTS: Record<TierCode, TierEntitlement> = {
  free: {
    code: "free",
    label: "Free",
    monthlyPriceGbp: 0,
    realtimeSignals: false,
    signalDelayMinutes: 120,
    portfolioEnabled: false,
    maxPositions: 0,
    seats: 1,
    dataExport: false,
    apiAccess: false,
  },
  pro: {
    code: "pro",
    label: "Pro",
    monthlyPriceGbp: 39,
    realtimeSignals: true,
    signalDelayMinutes: 0,
    portfolioEnabled: true,
    maxPositions: "unlimited",
    seats: 1,
    dataExport: false,
    apiAccess: false,
  },
  team: {
    code: "team",
    label: "Team",
    monthlyPriceGbp: 149,
    realtimeSignals: true,
    signalDelayMinutes: 0,
    portfolioEnabled: true,
    maxPositions: "unlimited",
    seats: 5,
    dataExport: true,
    apiAccess: true,
  },
  enterprise: {
    code: "enterprise",
    label: "Enterprise",
    monthlyPriceGbp: null,
    realtimeSignals: true,
    signalDelayMinutes: 0,
    portfolioEnabled: true,
    maxPositions: "unlimited",
    seats: "unlimited",
    dataExport: true,
    apiAccess: true,
  },
};
