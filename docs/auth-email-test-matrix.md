# Auth Email Deliverability Matrix

Use this matrix after SMTP cutover and on each auth-email template change.

## Environment

- Date:
- Executor:
- Supabase project:
- Sender configured:
- Reply-to configured:

## Test Cases

| Case | Flow | Provider | Inbox/Spam | From Correct | Reply-To Correct | Link Opens | Redirect Correct | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Signup verify | Gmail |  |  |  |  |  |  |
| 2 | Signup verify | Outlook |  |  |  |  |  |  |
| 3 | Signup verify | Corporate |  |  |  |  |  |  |
| 4 | Resend verify (`/verify-email`) | Gmail |  |  |  |  |  |  |
| 5 | Resend verify (`/verify-email`) | Outlook |  |  |  |  |  |  |
| 6 | Forgot password (`/forgot-password`) | Gmail |  |  |  |  |  |  |
| 7 | Forgot password (`/forgot-password`) | Outlook |  |  |  |  |  |  |
| 8 | Forgot password (`/forgot-password`) | Corporate |  |  |  |  |  |  |
| 9 | Reset completion (`/reset-password`) | Gmail |  |  |  |  |  |  |

## Pass Criteria

- All auth emails sent from `noreply@zephyr.markets`.
- Reply-to points to `support@zephyr.markets`.
- No broken links.
- Redirects resolve correctly to production app routes.
- No severe spam placement in test providers.
