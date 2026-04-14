# Auth Schema Contract

This document is the source of truth for auth/account ownership used by account deletion logic.

## Account Deletion Ownership Map

| Table | Owner key | Ownership reason | Delete mode |
| --- | --- | --- | --- |
| `alerts` | `user_id` | Per-user alert preferences and thresholds | direct by owner key |
| `email_trade_imports` | `user_id` | Per-user parsed import records | direct by owner key |
| `attribution_predictions` | `user_id` | Per-user attribution outputs tied to book context | direct by owner key |
| `portfolio_pnl` | `user_id` | Per-user portfolio PnL snapshots | direct by owner key |
| `positions` | `user_id` | Per-user position rows | direct by owner key |
| `team_members` | `user_id` | User membership rows across teams | direct by owner key |
| `team_invitations` | `invited_by` | Invitations created by the user | direct by owner key |
| `teams` | `owner_id` | Teams owned by the user | direct by owner key + team dependency cleanup |
| `profiles` | `id` | One profile per auth user id | direct by owner key |

## Team Dependency Cleanup Rules

When deleting a user account, if the user owns teams (`teams.owner_id = auth user id`):

1. delete `team_invitations` where `team_id` belongs to owned teams
2. delete `team_members` where `team_id` belongs to owned teams
3. delete `teams` where `owner_id = auth user id`

This ordering avoids FK constraint failures from `team_invitations.team_id -> teams.id` and `team_members.team_id -> teams.id`.

## Global/Shared Tables (Do Not Delete Per User)

These tables are not user-owned and must not be targeted with user-key deletes:

- `brief_entries`
- `premium_predictions`
- `scenario_predictions`
- `signal_predictions`
- `accuracy_metrics`

## Change Management Requirement

Any schema change in auth/account scope must update all of:

1. this file (`docs/auth-schema-contract.md`)
2. `app/api/account/delete/route.ts` cleanup targets/order
3. `ACCOUNT_DELETION_VERIFICATION.md` happy-path orphan checks
