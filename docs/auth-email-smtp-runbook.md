# Auth Email SMTP Runbook

This runbook configures Supabase Auth email delivery to use Zephyr domain sender identity.

## Target Sender Identity

- From name: `Zephyr`
- From email: `noreply@zephyr.markets`
- Reply-to: `support@zephyr.markets`

## Prerequisites

- Domain DNS is managed and validated for outbound sending.
- Provider SMTP credentials are available (Resend, Postmark, SES, etc).
- Supabase project admin access.

## Supabase Configuration

1. Open Supabase dashboard for production project.
2. Navigate to Authentication -> Email -> SMTP settings.
3. Enable custom SMTP.
4. Set SMTP host/port/user/password from provider.
5. Set sender email to `noreply@zephyr.markets`.
6. Set sender name to `Zephyr`.
7. Set reply-to to `support@zephyr.markets` when supported.

## Auth URL and Redirect Validation

Ensure the following URLs are correct in Supabase Authentication settings:

- Site URL: `https://zephyr.markets`
- Redirect URLs include:
  - `https://zephyr.markets/auth/callback`
  - `https://zephyr.markets/reset-password`
  - Preview URL patterns as needed

## Template Requirements

Apply branded templates for:

- Confirm signup email
- Reset password email
- Change email (if enabled)

Template requirements:

- Include Zephyr name and contact channels.
- Include security copy: if user did not request action, ignore email.
- Keep links short and explicit.

## Test Matrix (must pass before production cutover)

Run end-to-end tests for all auth emails:

1. Signup verification email delivery and callback.
2. Resend verification email from `/verify-email`.
3. Forgot password email from `/forgot-password`.
4. Reset password completion from `/reset-password`.

Inbox providers:

- Gmail
- Outlook
- Corporate domain mailbox

Validation checklist:

- From address is `noreply@zephyr.markets`.
- Reply-to resolves to support mailbox.
- Links point to production Zephyr domain.
- No obvious spam classification.

## Rollback

If deliverability fails after cutover:

1. Switch Supabase back to previous SMTP/default sender.
2. Pause signup campaigns.
3. Fix DNS/SPF/DKIM/DMARC and rerun test matrix.
