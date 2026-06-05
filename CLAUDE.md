# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Digitify Automator** — A TypeScript Node.js CLI for browser automation against the Digitify TMS. Currently handles login, navigation, and Excel download. Built to be extended with new automations.

## Commands

```bash
# Development
npm run dev                            # Run via tsx (no build step)
npm run build                          # Compile to ./dist (uses tsconfig.build.json)
npm start                              # Run compiled CLI at dist/apps/cli/index.js

# Code quality
npm run lint                           # ESLint
npm run lint:fix                       # Auto-fix ESLint
npm run typecheck                      # Type-check without emitting
npm run format                         # Prettier format
npm run format:check                   # Verify Prettier compliance

# Testing
npm test                               # Vitest (single run)
npm run test:watch                     # Vitest watch mode
npm run test:coverage                  # Coverage report

# Processing
npm run process:digitify               # Login → navigate → download (headed)
npm run process:digitify:headless      # Same but headless

# Utilities
npm run validate:selectors             # Verify Digitify CSS selectors still work
npm run digitify:uat-download          # UAT test download
npm run chrome:cdp:win                 # Launch Chrome with remote debugging (Windows)
npm run chrome:sync-profile:win        # Sync Chrome profile (Windows)
```

## Architecture

### Current workflow: `process:digitify`

```
CLI (apps/cli/index.ts)
  └─ buildProcessDigitifyCommand
       ├─ runStartupValidation   — checks NODE_ENV, temp dir, browser config
       ├─ BrowserManager.acquire — launch/attach Playwright browser context
       └─ runDigitifyDownloadPipeline
            ├─ Stage 1 sessionStage   — login via DigitifyClient
            ├─ Stage 2 navigateStage  — navigate to Advance page + apply filters
            └─ Stage 3 downloadStage  — download trip Excel to storage/temp/
```

### Adding a new automation

1. Add a new stage file under `workflows/digitify/stages/` — it receives `(client: DigitifyClient, ctx: WorkflowContext)` and returns `Result<T, Error>`.
2. Call it inside `runDigitifyDownloadPipeline` (or create a new pipeline file under `workflows/`).
3. Add a CLI command under `apps/cli/commands/` and register it in `apps/cli/index.ts`.

### Key modules

| Path | Role |
|------|------|
| `modules/digitify/` | All Digitify browser interactions — auth, navigation, downloads, documents |
| `services/browser/` | `BrowserManager` — Playwright lifecycle, CDP/Chrome profile attachment |
| `services/events/` | Optional Telegram/Slack notifications via `IEventBus` |
| `services/gemini/` | Google Gemini API client for OCR tasks |
| `services/retention/` | Cleans stale files from temp and debug directories |
| `services/startup/` | Pre-flight checks before the browser launches |
| `services/shutdown/` | Graceful SIGINT/SIGTERM handling |
| `contracts/services/` | `IEventBus`, `IDigitifyClient` interfaces for DI |
| `config/schema.ts` | Zod schema — validates all env vars at startup |
| `types/result.ts` | `Ok<T> \| Err<Error>` monad used throughout |

### Design patterns

**Result monad** — functions return `Result<T, Error>` instead of throwing; stages propagate errors explicitly.

**`WorkflowContext`** — passed through every stage: `runId`, `correlationId`, `logger`, `config`, `eventBus`, `startedAt`. Add new automations by extending this pattern.

**DigitifyClient** — façade over Playwright with methods like `login()`, `navigateToAdvance()`, `applyFilters()`, `downloadTrips()`. Add new Digitify interactions here.

### Environment configuration

Copy `.env.example` to `.env`. Key groups:
- `BROWSER_*` — Playwright settings, Chrome profile/CDP, session path
- `DIGITIFY_*` — base URL, credentials, CSS selectors for UI elements
- `GEMINI_API_KEY` — for future OCR automations
- `EVENTS_*` — optional Telegram/Slack webhook for notifications
- `STORAGE_TEMP_PATH` — where downloaded files land

Config is validated at startup via `config/schema.ts`; missing required vars exit early with a clear error.

### Path aliases

`@/*` maps to `src/*` (configured in `tsconfig.json`). Use `@/types`, `@/config`, `@/utils` etc. for imports.

### Testing

```bash
npx vitest run path/to/file.test.ts   # Run a single test file
```
