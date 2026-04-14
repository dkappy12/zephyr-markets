import { expect, test } from "@playwright/test";

test("signup to verify-email to login route smoke", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Join Zephyr" })).toBeVisible();

  await page.getByLabel("Full name").fill("Smoke User");
  await page.getByLabel("Work email").fill(`smoke+${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("Abcd1234!");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByText("Select the markets you trade or cover."),
  ).toBeVisible();

  await page.goto("/verify-email");
  await expect(
    page.getByRole("heading", { name: "Verify your email." }),
  ).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
});

test("authenticated delete-account attempt smoke (optional env-gated)", async ({
  page,
}) => {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  test.skip(
    !email || !password,
    "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run authenticated smoke.",
  );

  await page.goto("/login");
  await page.getByLabel("Email").fill(email as string);
  await page.getByLabel("Password").fill(password as string);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.goto("/dashboard/settings");
  await expect(page.getByText("Danger zone")).toBeVisible();

  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByLabel("Confirm password")).toBeVisible();
});
