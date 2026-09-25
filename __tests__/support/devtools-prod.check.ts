import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("the production example ships no devtools code", () => {
  const dir = fileURLToPath(new URL("../../example/dist/client/_astro/", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files)
    expect(readFileSync(`${dir}${file}`, "utf8")).not.toContain("TanstackQueryDevtools");
});
