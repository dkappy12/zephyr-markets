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
  markets: "gb_nbp_only" | "five_markets" | "all_markets";
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
    markets: "gb_nbp_only",
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
    maxPositions: 30,
    seats: 1,
    markets: "five_markets",
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
    markets: "all_markets",
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
    markets: "all_markets",
    apiAccess: true,
  },
};
