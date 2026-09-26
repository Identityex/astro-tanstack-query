# Contributing

Thanks for helping. This is an unofficial community project, so please file issues and pull
requests here rather than with the Astro or TanStack projects.

## Before you start

- **Bugs:** open an issue with a minimal reproduction: an Astro project, or a failing test in
  `__tests__/`. Include your Astro, `@tanstack/query-core`, nanostores and adapter versions.
- **Features:** open an issue first. Several things are deliberately out of scope (see
  [the README](README.md#limitations) and section 12 of [the design](docs/design.md)), and it is
  better to agree on an approach before you write code.
- **Security issues:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Setup

You need Node 24 (see `.nvmrc`) and npm.

```sh
git clone https://github.com/Identityex/astro-tanstack-query.git
cd astro-tanstack-query
npm install
npm install --prefix example   # the example app is the end-to-end fixture
npx lefthook install   # optional: format, lint and commitlint on commit
```

The pre-commit hook formats staged files with Prettier and skips the ones it has no parser for,
such as `.astro` and `.svelte`, as `npm run format:check` does.

## Repository layout

```text
src/              package source, one directory per entry point
components/       Astro components shipped as-is (QueryState, QueryDevtools)
example/          an Astro app using every framework; the end-to-end fixture
__tests__/
  src/            unit tests mirroring src/
  support/        virtual-module fixtures, tree-shaking tests, production *.check.ts
  e2e/            Playwright specs against the built example
docs/design.md    design decisions and the reasons for them
```

## Checks

CI runs all of these on every pull request. Run the ones that match your change locally:

| Command                          | What it checks                                        |
| -------------------------------- | ----------------------------------------------------- |
| `npm run format:check`           | Prettier formatting (`npm run format` to fix)         |
| `npm run lint`                   | Oxlint, then type-aware ESLint                        |
| `npm run typecheck`              | Package source and tests                              |
| `npm run build`                  | ESM output and declarations                           |
| `npm --prefix example run check` | `astro check` on the example app (run after `build`)  |
| `npm test`                       | Unit and support tests; builds first                  |
| `npm run check:package`          | `publint` and Are the Types Wrong (run after `build`) |
| `npm run size`                   | Bundle-size budgets (run after `build`)               |
| `npm run e2e`                    | Playwright suite against two builds of the example    |
| `npm run test:prod`              | Production checks, such as Devtools exclusion         |

Before the first `npm run e2e`, install the browser with `npx playwright install chromium`.

## Guidelines

- **Keep per-request isolation intact.** Never add an importable server `QueryClient`, and
  never cache anything at module scope on the server. [Design](docs/design.md) decision D4
  explains why.
- **Keep the browser cost down.** A change that pushes a `size-limit` budget up needs a reason
  in the pull request, and `.size-limit.js` should record the new measurement.
- **Test behaviour, not implementation.** Unit tests use real `query-core` with fake fetchers.
  Anything involving hydration, streaming or several frameworks belongs in the Playwright suite.
- **Document decisions.** If you change a decision recorded in `docs/design.md`, update the
  document in the same pull request.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:` and so on).

## Changesets and releases

Any change that affects published behaviour needs a changeset:

```sh
npx changeset
```

Choose `patch` for fixes and `minor` for features or breaking changes (until 1.0, breaking
changes are minor bumps and must say so in the changeset). Documentation-only and test-only
changes do not need one.

When changesets reach `main`, the release workflow opens a "Version packages" pull request.
Merging it updates `CHANGELOG.md` and publishes to npm with provenance. Publishing needs either
npm trusted publishing configured for this repository or an `NPM_TOKEN` secret; the very first
version is published by hand, because trusted publishing can only be configured on a package
that already exists.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
