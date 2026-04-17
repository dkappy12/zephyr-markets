export type TierCode = "free" | "pro" | "team" | "enterprise";

export type TierEntitlement = {
  code: TierCode;
  label: string;
  monthlyPriceGbp: number | null;
  realtimeSignals: boolean;
  signalDelayMinutes: number;
  morningBriefTimeGmt: "06:00" | "08:00";
  portfolioEnabled: boolean;
  maxPositions: number | "unlimited";
  seats: number | "unlimited";
  signalHistoryMonths: number | "unlimited";
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
    morningBriefTimeGmt: "08:00",
    portfolioEnabled: false,
    maxPositions: 0,
    seats: 1,
    signalHistoryMonths: 0,
    dataExport: false,
    apiAccess: false,
  },
  pro: {
    code: "pro",
    label: "Pro",
    monthlyPriceGbp: 39,
    realtimeSignals: true,
    signalDelayMinutes: 0,
    morningBriefTimeGmt: "06:00",
    portfolioEnabled: true,
    maxPositions: "unlimited",
    seats: 1,
    signalHistoryMonths: 12,
    dataExport: false,
    apiAccess: false,
  },
  team: {
    code: "team",
    label: "Team",
    monthlyPriceGbp: 149,
    realtimeSignals: true,
    signalDelayMinutes: 0,
    morningBriefTimeGmt: "06:00",
    portfolioEnabled: true,
    maxPositions: "unlimited",
    seats: 5,
    signalHistoryMonths: 12,
    dataExport: true,
    apiAccess: true,
  },
  enterprise: {
    code: "enterprise",
    label: "Enterprise",
    monthlyPriceGbp: null,
    realtimeSignals: true,
    signalDelayMinutes: 0,
    morningBriefTimeGmt: "06:00",
    portfolioEnabled: true,
    maxPositions: "unlimited",
    seats: "unlimited",
    signalHistoryMonths: "unlimited",
    dataExport: true,
    apiAccess: true,
  },
};
