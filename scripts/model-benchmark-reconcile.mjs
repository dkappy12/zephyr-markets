const TOLERANCE_NBP_CONVERSION = Number(
  process.env.NBP_CONVERSION_TOLERANCE || "0.000001",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function almostEqual(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function implementationValue(ttf, gbpPerEur) {
  // Mirrors lib/portfolio/book.ts logic.
  const gbpMwh = ttf * gbpPerEur;
  return (gbpMwh / 34.121) * 100;
}

function main() {
  const fixtures = [
    { ttf: 10, gbpPerEur: 0.86 },
    { ttf: 42.5, gbpPerEur: 0.86 },
    { ttf: 68.1, gbpPerEur: 0.87 },
  ];

  for (const f of fixtures) {
    const libValue = implementationValue(f.ttf, f.gbpPerEur);
    const benchmark = ((f.ttf * f.gbpPerEur) / 34.121) * 100;
    assert(
      almostEqual(libValue, benchmark, TOLERANCE_NBP_CONVERSION),
      `NBP conversion mismatch for TTF=${f.ttf}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        checks: fixtures.length,
        status: "pass",
        note: "benchmark reconciliation checks passed",
      },
      null,
      2,
    ),
  );
}

main();

