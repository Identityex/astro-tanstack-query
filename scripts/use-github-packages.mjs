// Release-time only: GitHub Packages accepts scoped names only, so the published package is
// @identityex/astro-tanstack-query. The source keeps the unscoped name because the shipped
// .astro components and the virtual config import "astro-tanstack-query/..." by name; consumers
// install it under that name with an npm alias (see README "Install").
// npm provenance is npmjs-only, so it is dropped for this registry.
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.name = "@identityex/astro-tanstack-query";
pkg.publishConfig = { registry: "https://npm.pkg.github.com" };
writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
