# CLAUDE.md

Guardrails for agent work on this Bitfocus Companion module (Yodeck REST API). Structure and conventions come from the Bitfocus module template and [Bitfocus's module-development guidelines](https://companion.free/for-developers/module-development/) — don't deviate without a clear reason.

## Scope

Controls Yodeck screens via `https://app.yodeck.com/api/v2` (auth: `Authorization: Token <label>:<value>`): push/refresh content, find media, schedule event exceptions, screen takeovers, and emergency alerts.

The boundary is **quick-trigger fit**: a button configured once and pressed repeatedly to do the same meaningful thing. Anything whose core input is unique data typed at press time, or that's one-off admin/setup (media upload, playlist/layout/schedule CRUD, webhooks), stays in Yodeck's web UI. Read the scope section of [ROADMAP.md](./ROADMAP.md) before adding an action.

## Conventions

- **ESM.** Relative imports use `.js` extensions (`verbatimModuleSyntax` requires it).
- **`Update*(self)` delegates.** `actions.ts`, `feedbacks.ts`, `variables.ts`, `presets.ts` each export one `Update*(self: ModuleInstance)` called from `main.ts`. Add new items inside these — no per-item files or registries.
- **Thin actions, fat instance methods.** Action callbacks parse options and call one `async` method on `ModuleInstance`; API calls, error handling and variable/feedback updates live in `main.ts`. Precedent: `bitfocus/companion-module-talkboardai-api`.
- **`src/yodeck-api.ts`** wraps only endpoints something actually calls, plus a single `YodeckApiError`.
- **No new runtime dependencies** without a real reason — native `fetch` covers HTTP, and `.yarnrc.yml`'s `npmPreapprovedPackages` is scoped to `@companion-module/*`.
- **ESLint/Prettier configs are centrally maintained** by `@companion-module/tools`. No local overrides; run `yarn format`.
- **`companion/manifest.json`'s `version` and `runtime.apiVersion` stay `"0.0.0"`** — they're set at package time.
- **`src/upgrades.ts` is append-only.** Never edit or remove an entry; add one only when a shipped option shape changes.

## Before considering a change done

- `yarn build` and `yarn lint` pass with zero errors and no suppressions.
- Never commit with `--no-verify`.
- Update ROADMAP.md's checklists when work lands, and keep changes scoped to the phase being worked on.
