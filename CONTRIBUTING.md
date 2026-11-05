# Contributing to Beeblio

Thanks for helping improve Beeblio. Please open an issue before starting a large change so the approach can be discussed.

## Local development

Follow the setup in [README.md](README.md). Use Node.js 24 and pnpm 11, then run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm build:eve
```

If you change the desktop app or the local server launcher (`scripts/local-servers.mjs`), also run `pnpm --dir desktop install` and `pnpm --dir desktop typecheck`, and check that both `pnpm dev` and `pnpm desktop` still start. If your change affects the installed app (its servers, paths, or packaging), build an installer as described in the README's "Build the installers" and check that it starts with a fresh profile, opens Settings on first run, and leaves no server processes after you quit. The [Desktop release](.github/workflows/desktop-release.yml) workflow can also be run by hand from the Actions tab to build all installers.

Do not commit `.env.local`, `.beeblio/`, linked project files, generated builds, or API credentials. Update the README and `.env.example` when changing setup or configuration. Explain behavior changes and how you checked them in pull requests.

## Contribution terms

Beeblio is open source under the [Apache License 2.0](LICENSE.md). By submitting a pull request, you agree to license your contribution under Apache License 2.0, unless you explicitly state otherwise. You retain copyright in your contribution.

## Reporting problems

For bugs and feature requests, open a GitHub issue with steps to reproduce and the expected behavior. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of posting details publicly.
