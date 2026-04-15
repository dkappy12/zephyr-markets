/**
 * Canonical portfolio stress scenarios (Optimise + Risk). Keep numeric moves in sync.
 */
export type StressScenarioData = {
  id: string;
  /** Short label for Optimise / compact UI */
  label: string;
  /** Risk tab display name */
  name: string;
  period: string;
  description: string;
  gbPowerMove: number;
  ttfMoveEurMwh: number;
  nbpMovePth: number;
};

export const PORTFOLIO_STRESS_SCENARIOS: StressScenarioData[] = [
  {
    id: "stress-2022-energy-crisis",
    label: "2022 Energy Crisis Peak",
    name: "2022 Energy Crisis Peak",
    period: "August 2022",
    description:
      "European gas and power markets reached record highs following supply disruptions",
    gbPowerMove: 400,
    ttfMoveEurMwh: 100,
    nbpMovePth: 150,
  },
  {
    id: "stress-ukraine-invasion",
    label: "Ukraine Invasion Spike",
    name: "Ukraine Invasion Spike",
    period: "February 2022",
    description:
      "Immediate market reaction to Russia's invasion of Ukraine",
    gbPowerMove: 150,
    ttfMoveEurMwh: 50,
    nbpMovePth: 60,
  },
  {
    id: "stress-gas-supply-crisis",
    label: "2021 Gas Supply Crisis",
    name: "2021 Gas Supply Crisis",
    period: "October 2021",
    description:
      "Low storage and reduced Norwegian flows drove GB gas to record levels",
    gbPowerMove: 200,
    ttfMoveEurMwh: 80,
    nbpMovePth: 100,
  },
  {
    id: "stress-wind-drought",
    label: "Wind Drought Event",
    name: "Wind Drought Event",
    period: "January 2025",
    description:
      "Sustained low wind output drove gas-marginal pricing across GB",
    gbPowerMove: 80,
    ttfMoveEurMwh: 5,
    nbpMovePth: 8,
  },
  {
    id: "stress-renewables-oversupply",
    label: "Renewable Oversupply",
    name: "Renewable Oversupply",
    period: "Summer 2024",
    description:
      "High wind and solar drove negative pricing across multiple settlement periods",
    gbPowerMove: -40,
    ttfMoveEurMwh: -2,
    nbpMovePth: -3,
  },
  {
    id: "stress-2023-spring-tightness",
    label: "2023 Spring tightness",
    name: "2023 Spring tightness",
    period: "March 2023",
    description:
      "Residual winter risk and storage anxiety; GB power and gas curves stayed bid after the EU winter",
    gbPowerMove: 175,
    ttfMoveEurMwh: 42,
    nbpMovePth: 58,
  },
];
