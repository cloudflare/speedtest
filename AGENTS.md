# AGENTS.md

Browser-side JS library (`@cloudflare/speedtest`) that measures connection
quality against Cloudflare's edge. Powers speed.cloudflare.com.

## Commands

```sh
pnpm install        # install deps
pnpm build          # tsdown → dist/speedtest.js (ESM) + copies .d.ts
pnpm dev            # tsdown watch mode
pnpm lint           # eslint src/**/*.js *.json
pnpm format         # prettier --write src/**/*.js
pnpm test           # run all tests (unit + e2e)
pnpm test:unit      # run unit tests only (fast, no browser)
pnpm test:e2e       # run e2e tests only (Playwright, needs Chromium)
pnpm test:watch     # run tests in watch mode
```

## Tests

Uses **Vitest** with two test projects:

- **Unit tests** (`tests/unit/**/*.test.ts`) — pure function tests for utils,
  config, and Results. Run in Node, no browser needed. Fast.
- **E2E tests** (`tests/e2e/*.test.ts`) — runs a realistic speed test in a real
  Chromium browser via Vitest Browser Mode + Playwright. Tests the full library
  integration (fetch, PerformanceResourceTiming, module loading) with multiple
  measurement phases (latency, download, upload), loaded latency, AIM scoring,
  and raw data point validation. Packet loss is skipped (CORS limitation).

Test files are written in TypeScript (`.test.ts`). Source is still JS.

To run e2e tests locally, install Chromium first: `npx playwright install chromium`

## Key constraints

- **Browser-only** — code uses `fetch`, `PerformanceResourceTiming`,
  `RTCPeerConnection`, `performance.now()`. Never introduce Node.js-only APIs.
  `eslint-plugin-compat` enforces this.
- **Zero runtime dependencies** — do not add npm dependencies.
- **ESM-only** (`"type": "module"`) — use `import`/`export`, never `require()`.
- **TypeScript declarations are hand-maintained** in `src/index.d.ts`. Changes
  to the public API require manual `.d.ts` updates.

## Style

Prettier + ESLint run on commit via `lint-staged` (Husky pre-commit hook).

- **No trailing commas** (`trailingComma: "none"`)
- Single quotes, no parens on single-param arrows (`arrowParens: "avoid"`)
- Private class fields use `#field` syntax throughout

## Architecture

- `src/index.js` — entrypoint. Exports `LoggingMeasurementEngine` (default),
  which wraps `MeasurementEngine` and logs results to `aim.cloudflare.com`.
- `src/config/` — default config and AIM scoring thresholds.
- `src/engines/` — sub-engines for each measurement type:
  - `BandwidthEngine/` — HTTP fetch-based download/upload via `PerformanceResourceTiming`
  - `PacketLossEngine/` — WebRTC TURN relay for UDP packet loss
  - `LoadNetworkEngine/` — parallel fetch load generator
  - `ReachabilityEngine/` — simple fetch with timeout
- `src/Results/` — aggregation, stats (percentile, jitter), and AIM scoring.
- `src/utils/` — small math helpers (`sum`, `avg`, `percentile`, `scaleThreshold`).
- `example/turn-worker/` — separate Cloudflare Worker sub-project with its own
  `package.json` and Prettier config; not part of the library build.

## PRs and releases

- PRs target `main`. Branch protection requires 1 approval and CI to pass.
- CI runs `pnpm install && pnpm build && pnpm lint` on Node 22.x and 24.x.
- CI also runs unit tests (`pnpm test:unit`) and e2e tests (`pnpm test:e2e`).
- Releases are **manual**, not automatic per PR:
  1. Go to **Actions > "Create Release PR"** > pick `patch`/`minor`/`major` > Run.
  2. The workflow creates a `releases/v*` PR with the version bump.
  3. A team member reviews and merges the release PR.
  4. On merge, the publish workflow auto-creates a git tag and publishes to npm.
- **Do NOT** push directly to `main` — the branch ruleset blocks direct pushes.
  All changes must go through a pull request.
