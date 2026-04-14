const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const cookie = process.env.AUTH_COOKIE || "";
const endpoint = process.env.ENDPOINT || "/api/classify-positions";
const method = (process.env.METHOD || "POST").toUpperCase();
const burst = Number(process.env.BURST || "20");

const payloadByEndpoint = {
  "/api/classify-positions": {
    headers: ["instrument", "market", "size"],
    rows: [{ instrument: "GB Base", market: "GB_power", size: 1 }],
  },
  "/api/brief/personalise": {
    normalised_score: 1.5,
    direction: "UP",
    positions: [{ instrument: "GB Base", market: "GB_power", direction: "long", size: 1 }],
  },
};

const body = payloadByEndpoint[endpoint] ?? {};

async function run() {
  let first429 = null;
  for (let i = 0; i < burst; i += 1) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
    const retryAfter = res.headers.get("retry-after");
    if (res.status === 429 && !first429) {
      first429 = { index: i + 1, retryAfter };
    }
    // eslint-disable-next-line no-console
    console.log(
      `[${i + 1}/${burst}] status=${res.status} retry-after=${retryAfter ?? "-"}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(first429 ? `First 429 at request ${first429.index}` : "No 429 observed");
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
