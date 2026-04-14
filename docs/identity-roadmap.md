# Identity Roadmap (Later Phase)

This document defines design direction for MFA, SSO, and SCIM rollout after core auth hardening.

## Phase Targets

- Phase A (later): MFA for Team/admin users.
- Phase B (later): Enterprise SSO (OIDC/SAML).
- Phase C (later): SCIM provisioning lifecycle.

## MFA Policy

- Individual tier: optional MFA.
- Team/admin roles: required MFA.
- Method order:
  1. TOTP
  2. WebAuthn/passkeys (follow-on)

Operational requirements:

- Recovery codes.
- Admin-enforced MFA policy toggle.
- Step-up auth for sensitive account actions.

## SSO Readiness

Protocol targets:

- OIDC (first)
- SAML (as enterprise demand requires)

Design requirements:

- Org-to-identity-provider mapping.
- Just-in-time user provisioning with role mapping.
- Session policy alignment (idle + absolute timeouts).
- Account linking conflict strategy.

## SCIM Readiness

Required resources:

- Users
- Groups/teams

Lifecycle rules:

- Create, update, deactivate (soft delete first).
- Immutable audit trail for role and membership changes.
- Deprovision safeguards for admin users.

## Data Model Preparation

- Stable organization identity key.
- Team membership source-of-truth.
- Role provenance metadata (manual vs SSO/SCIM managed).

## Implementation Exit Criteria

- MFA enforceable per role policy.
- SSO login with deterministic role/team mapping.
- SCIM deprovision events reflected in app authorization within SLA.
- Security and audit controls verified through runbook tests.
