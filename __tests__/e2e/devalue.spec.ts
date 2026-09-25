import { expect, test } from "@playwright/test";

// The serializer is a build-wide option, so this page comes from the second webServer: an example
// built with ASTRO_TQ_SERIALIZER=devalue and served on 4332.
const devalueUrl = "http://127.0.0.1:4332/devalue";

test("a devalue build hydrates a Date through the state element", async ({ page }) => {
  await page.goto(devalueUrl);

  // The state element existing at all is what proves emit: "component" placed <QueryState /> here.
  const state = page.locator("#astro-tq");
  await expect(state).toHaveCount(1);
  await expect(state).toHaveAttribute("data-serializer", "devalue");

  await expect(page.locator("#out")).toHaveText("true");
});
