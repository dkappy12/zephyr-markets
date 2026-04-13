import { NextResponse } from "next/server";

export const revalidate = 3600; // cache for 1 hour

export async function GET() {
  try {
    const resp = await fetch(
      "https://api.frankfurter.app/latest?from=EUR&to=GBP",
      {
        next: { revalidate: 3600 },
      },
    );
    if (!resp.ok) throw new Error("Frankfurter API failed");
    const data = await resp.json();
    const rate = data.rates.GBP;
    return NextResponse.json({
      rate,
      source: "frankfurter",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      rate: 0.86,
      source: "fallback",
      timestamp: new Date().toISOString(),
    });
  }
}
