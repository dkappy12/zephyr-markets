# Auth Email Templates

Use these templates in Supabase Auth email settings.

## Sender

- From: `Zephyr <noreply@zephyr.markets>`
- Reply-to: `support@zephyr.markets`

## Verify Email Subject

`Verify your Zephyr account`

## Verify Email Body (plain)

```text
Hello,

Please verify your Zephyr account using the secure link below:
{{ .ConfirmationURL }}

If you did not request this account, you can safely ignore this email.

Zephyr Markets
contact@zephyr.markets
```

## Reset Password Subject

`Reset your Zephyr password`

## Reset Password Body (plain)

```text
Hello,

A request was received to reset your Zephyr password.
Use this secure link to continue:
{{ .ConfirmationURL }}

If you did not request this reset, you can safely ignore this email.

Zephyr Markets
support@zephyr.markets
```

## Change Email Subject

`Confirm your Zephyr email change`

## Change Email Body (plain)

```text
Hello,

Please confirm your Zephyr email change using the link below:
{{ .ConfirmationURL }}

If you did not request this change, contact support@zephyr.markets immediately.

Zephyr Markets
support@zephyr.markets
```

## Notes

- Keep content concise and security-focused.
- Avoid marketing language in auth emails.
- Ensure links point to `zephyr.markets` redirects after clickthrough.
