# API Auth Contract

This document defines auth and security response conventions for protected APIs.

## Protected Route Requirements

- Resolve session user using `requireUser(...)`.
- Return auth failures using stable JSON payloads.
- Apply CSRF/same-origin check for mutating cookie-authenticated endpoints.
- Apply per-endpoint rate limiting.

## Standard Error Shapes

### Unauthorized

Status: `401`

```json
{ "code": "UNAUTHORIZED", "error": "Unauthorized" }
```

### Email unverified

Status: `403`

```json
{ "code": "EMAIL_UNVERIFIED", "error": "Email verification required" }
```

### CSRF blocked

Status: `403`

```json
{ "code": "CSRF_BLOCKED", "error": "Cross-site request blocked." }
```

### Rate limited

Status: `429`

```json
{ "code": "RATE_LIMITED", "error": "Too many requests. Please wait before retrying." }
```

Response header:

- `Retry-After: <seconds>`

## Endpoint Classes

- Public read endpoints: no auth required.
- Protected read endpoints: `requireUser(...)`, rate limit.
- Protected mutating endpoints: `requireUser(...)`, `assertSameOrigin(...)`, rate limit.

## Implementation References

- `lib/auth/require-user.ts`
- `lib/auth/request-security.ts`
- `lib/auth/rate-limit.ts`
