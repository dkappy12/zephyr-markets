# Upstash Rate-Limit Rollout

This rollout enables distributed rate limiting in production.

## Required Environment Variables (Vercel Production)

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Deployment Steps

1. Add both env vars in Vercel Project Settings -> Environment Variables.
2. Scope to `Production` (and `Preview` if desired).
3. Redeploy latest `main`.
4. Confirm no runtime errors in API logs.

## Validation

Use a burst test against protected endpoints:

- `POST /api/brief/personalise`
- `POST /api/classify-positions`
- `GET /api/optimise/recommendations`

Expected behavior when threshold exceeded:

- status `429`
- JSON body includes `code: "RATE_LIMITED"`
- `Retry-After` response header is present

## Fallback Behavior

If Upstash is unavailable, limiter falls back to in-memory mode.
This is acceptable for local/dev but not ideal for horizontally scaled production.

## Operational Check

- Verify sustained rate limiting remains consistent across repeated requests.
- If behavior is inconsistent, verify env vars and Upstash token permissions.
