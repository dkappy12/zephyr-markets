# CSRF Checklist For Authenticated APIs

Apply this checklist to every mutating endpoint that relies on cookie-authenticated sessions.

## Required Controls

- [ ] Use `assertSameOrigin(request)` at top of handler.
- [ ] Use `requireUser(...)` for user/session enforcement.
- [ ] Return structured error codes for blocked requests.
- [ ] Add rate limiting policy for request class.

## Endpoint Scope

Mutating methods:

- `POST`
- `PUT`
- `PATCH`
- `DELETE`

Read-only methods (`GET`) should not require same-origin checks unless they produce sensitive one-time actions.

## Verification

- Browser-origin request from same site succeeds.
- Cross-origin crafted request fails with `403` + `CSRF_BLOCKED`.
- Existing authenticated workflows continue to function normally.
