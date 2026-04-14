import { expect, test } from "@playwright/test";

test("portfolio routes are reachable from unauthenticated state", async ({
  page,
}) => {
  await page.goto("/dashboard/portfolio/book");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/dashboard/portfolio/risk");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/dashboard/portfolio/attribution");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/dashboard/portfolio/optimise");
  await expect(page).toHaveURL(/\/login/);
});
