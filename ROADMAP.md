# Roadmap

What's built, what's deliberately out of scope, and what still needs verifying. Keep the checklists in sync as work lands.

> **⚠️ Untested against a real Yodeck account.** Everything builds and passes lint/manifest validation, and was written against Yodeck's published OpenAPI spec, but none of it has run against live screens. Treat it as "implemented, not verified" until the [verification checklist](#verification-checklist-not-yet-run) has been run.

## Phases

- [x] **Phase 0 — Planning.** API research, template survey, architecture.
- [x] **Phase 1 — Push content.** **Push New Content to Screen(s)** (assign + push, single or multiple screens) and **Refresh Screen(s)** (re-push without reassigning), with bulk-push status polling, `push_*` feedbacks/variables, and connection validation.
- [x] **Phase 2 — Screen status.** ~60s background poll of `GET /screens` backing the `screen_online` feedback, `screens_online_count`/`screens_total_count`, screen-name resolution for target variables, workspace targeting, and 429 retry/backoff.
- [x] **Phase 3 — Media.** **Find Media** (name/tag/workspace search) with `found_media_*` variables and feedbacks.
- [x] **Phase 4 — Playlists & layouts.** ~5-minute background cache backing searchable Playlist/Layout pickers in Push New Content (first upgrade script).
- [x] **Phase 5 — Schedules.** Schedule picker (second upgrade script) and **Add Schedule Event Exception** (`skip_on`/`skip_from`).
- [x] **Phase 6 — Takeover & emergency alerts.** **Take Over Screen(s)** (with Clear Takeover), **Broadcast Emergency Alert**, **Cancel All Emergency Broadcasts**, **Cancel Broadcast**, plus panic-button presets.

## Scope: quick-trigger fit

Companion buttons are configured once and pressed repeatedly to do the same meaningful thing. Anything whose core input is unique free-form data typed at press time, or that's a one-off admin/setup task, belongs in Yodeck's web UI instead. On that basis these were built and then removed, or evaluated and excluded:

- **Upload Media** — needs a unique file per invocation; Yodeck's upload UI is strictly better.
- **Create/Update/Delete Playlist, Layout, Schedule** — Create yields an empty resource you then edit in Yodeck anyway, Update is a form not a trigger, Delete is rare and destructive with no confirmation UX.
- **Webhooks** — one-time integration setup, and receiving them would need Companion to accept inbound HTTP.

What fits: Push/Refresh (same content and target every press), Find Media (fixed query, e.g. "whatever is tagged `daily-special`"), Add Schedule Event Exception ("Skip Today" with a date variable), takeover and emergency alerts (panic buttons). The read-only list endpoints stay, since they back pickers for browsing existing content.

## Yodeck REST API reference

Confirmed against the public OpenAPI spec at `https://app.yodeck.com/api-docs/bundle.yaml`.

- Base URL `https://app.yodeck.com/api/v2` (SaaS only). Auth header `Authorization: Token <label>:<value>`.
- Errors: `{"error": {"code", "message", "details", "timestamp"}}`. `details` often holds the real reason for a 400, so the module folds it into the error message.
- Rate limits are per token **and** per account; `429` comes with `Retry-After` and no body. Screens endpoints: 21 req/10s per token, 63 per account.
- Lists use DRF-style pagination (`count`/`next`/`previous`/`results`, `limit`/`offset`).

Endpoints in use:

| Endpoint                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /screens`                                                           | Base response includes `state: {online, last_seen, updating, registered}`; filterable by `workspace`.                                                                                                                                                                                                                                                             |
| `PATCH /screens/{id}`                                                    | `{"screen_content": {"source_type": "media"\|"playlist"\|"layout"\|"schedule"\|"turned_off", "source_id"}}`.                                                                                                                                                                                                                                                      |
| `POST /screens/{id}/push`                                                | Synchronous. Returns **200 even on logical failure** — check the body's `status`.                                                                                                                                                                                                                                                                                 |
| `POST /screens/push`                                                     | Async bulk re-push of already-assigned content. `filter_devices: [...]` or no filter (= all screens); an empty `filter_devices` is a 400, and screens lacking `apply_changes` permission are **silently dropped**. The module resolves workspaces client-side and never uses `filter_workspaces`, so an empty workspace fails loudly instead of no-op succeeding. |
| `GET /screens/push/status`                                               | No push ID — always the account's most recent push. `initialized` / `in_progress` (`progress`) / `completed` (`screens: [{id, name}]`) / `failed` (`errors`).                                                                                                                                                                                                     |
| `PUT /screens/{id}/takeover`, `PUT /screens/takeover`                    | `takeover_content: {source_id, source_type: media\|playlist\|layout, duration? (min, ≥5)}` or `null` to clear. No schedule source.                                                                                                                                                                                                                                |
| `GET /media`                                                             | `q`, `tags`, `workspace`, `limit`. Backs Find Media (first page only).                                                                                                                                                                                                                                                                                            |
| `GET /playlists`, `/layouts`, `/schedules`                               | Picker caches. `/playlists` has **no** `workspace` filter.                                                                                                                                                                                                                                                                                                        |
| `PATCH /schedules/{id}/add-event-exception`                              | `{"event_id", "exceptions": [{"skip_on"} \| {"skip_from"}]}` → 202 `{info, note?}`. Can remove the event entirely; `note` explains when.                                                                                                                                                                                                                          |
| `GET /emergency-alerts`, `GET /emergency-alerts/broadcast-screen-groups` | Read-only; configured in Yodeck's UI.                                                                                                                                                                                                                                                                                                                             |
| `POST /emergency-alerts/{id}/broadcast`                                  | All fields optional (`headline`, `description`, `instruction`, `duration` s default 7200, `workspace`, `broadcast_screen_group`) → 201 with `broadcast_hash`.                                                                                                                                                                                                     |
| `DELETE /emergency-alerts/broadcasts`                                    | Cancel all → 200 `{results}`.                                                                                                                                                                                                                                                                                                                                     |
| `DELETE /emergency-alerts/broadcasts/{hash}`                             | Cancel one → 204. Hash is URL-encoded.                                                                                                                                                                                                                                                                                                                            |

Not used, possibly relevant later: `/groups`, `/media/bulk`, `/media/tags`, non-local media sources, playlist/layout/schedule composition, `GET /emergency-alerts/broadcasts`.

## Design notes

- Architecture is modeled on `bitfocus/companion-module-talkboardai-api` (same `@companion-module/base` version), corroborated by `companion-module-generic-http` and `companion-module-planningcenter-serviceslive`. Check these before introducing a different pattern.
- **Fail rather than guess.** Every ID field requires a whole number; unresolved variables, partial numbers (`7-holiday`), empty resolved targets, and hidden-but-stale field values are rejected instead of acting on a different or broader target. For fields where blank means something (takeover Duration = indefinite, broadcast Duration = 7200s, Find Media Workspace = all), junk is rejected rather than treated as blank.
- **Success must be confirmed per screen.** Bulk push and bulk takeover succeed only if every targeted screen appears in Yodeck's response.
- **Attempts are serialized per action family.** Push/refresh share one queue (shared `last_push_*` variables and the account-wide push status record); takeovers share another. Background polls have in-flight guards.
- The five picker caches refresh independently (`Promise.allSettled`), so one unavailable resource (typically emergency alerts on a lower plan) doesn't empty the others or flap connection status.
- Screen targets stay free-text rather than dropdowns: multi-screen entry needs comma-separated values, and large accounts make a full screen dropdown worse than typing an ID.

### Known limitations (accepted)

- A stale or empty **Broadcast Screen Group** can broadcast to zero screens without error — the API exposes only the group's tags, not its membership.
- `GET /screens/push/status` can't be scoped to a push, so overlapping pushes from another Companion instance or token on the same account can still collide.
- The 10s request timeout also applies to the synchronous single-screen push; a slow screen could be reported as failed after the push went through.
- `found_media_*` variables don't follow the `last_<family>_*` prefix; left as-is to match the `find_media` action/feedback ids.
- `src/upgrades.ts`'s second script can persist an `undefined` `source_id_schedule` for very old buttons with no `source_id`. Harmless (the action rejects it as "No content ID provided"), and upgrade scripts are append-only.

## Open questions (need a live account)

- How quickly `state.online` flips, and whether every player type reports it.
- Whether `GET /screens/push/status` already reflects a new push by the time `POST /screens/push` returns, and whether `completed` can ever be a partial success.
- Whether an `allowCustom` dropdown in expression mode accepts a value outside its `choices` (or silently skips the action), and what shape expression-mode values take.
- Real event-removal behavior and `note` text from `add-event-exception`.
- Whether timed takeovers auto-revert, and how a broadcast looks on-screen.
- The actual shape of `broadcast_screens` in the broadcast response (the spec types it as a single object) — it could close the screen-group gap above.

## Verification checklist (not yet run)

Test takeover and emergency broadcasts against a non-production screen/workspace first — both are visibly disruptive.

**Connection & status**

1. `yarn install`, `yarn build`, `yarn lint` pass.
2. Status goes Connecting → OK with a real token; a wrong token gives the right error.
3. Start Companion with no network (or a bad token), fix it without re-saving config; status returns to OK within ~1 minute.
4. `screens_online_count`/`screens_total_count` populate within ~60s; a `screen_online` feedback tracks a real screen being unplugged/replugged.
5. A partly-numeric Screen ID (`7-holiday`) in `screen_online` does not light for screen 7.
6. On an account/token without emergency-alert access, Playlist/Layout/Schedule pickers still populate and status stays OK.

**Push & refresh**

7. Single-screen and multi-screen push with media and playlist content; `last_push_progress`, `last_push_status` and the feedbacks update correctly.
8. Bad screen ID and bad content ID surface in `last_push_error_message`.
9. `last_push_target_names` shows real screen names.
10. Push/refresh by workspace reaches only that workspace; a stale workspace ID fails with "No screens to target".
11. Push to a workspace with 30+ screens completes without rate-limit failures; rapid repeated presses either succeed via retry or report a clear rate-limit error.
12. Two multi-screen pushes pressed within a second: the second waits for the first, and each reports its own screens. Same for a single-screen refresh pressed right after a multi-screen one.
13. Right after `POST /screens/push`, read `GET /screens/push/status` by hand and record whether it already reflects the new push.
14. `12, notanumber, 13` in a multi-screen field is rejected outright.
15. A partly-numeric Content/Workspace/Schedule/Event ID (`7-holiday`, `3.9`) fails with a "No … provided" error.

**Pickers & upgrades**

16. Playlist, Layout and Schedule created in Yodeck appear in the pickers (within ~5 min or after restarting the connection), and pushing each shows the right content.
17. A raw numeric ID typed into each picker works; an expression resolving to an ID not in the choices runs rather than being skipped.
18. Renames/additions in Yodeck appear within ~5 minutes.
19. Old-shape `push_content` configs (single `source_id` with each `source_type`; `schedule` with `source_id_text`) upgrade into the right new fields with no lost IDs.

**Find Media**

20. Lookup by name and by tag sets `found_media_id` and fires `find_media_succeeded`; pushing that ID shows the media.
21. A forced failure sets `found_media_status: failed` and fires `find_media_failed`.

**Schedule event exceptions**

22. "Skip This Date" removes one occurrence of a recurring event; "Skip From This Date Onward" stops all later ones.
23. The event-removal case actually removes the event and `last_schedule_exception_info` captures Yodeck's `note`.
24. A malformed date is rejected without an API call; a bad Event ID surfaces the API error. Feedbacks are independent of push feedbacks.

**Takeover**

25. Single-screen takeover with Media, Playlist and Layout and a 5-minute duration displays immediately and auto-reverts.
26. Specific screens, workspace and all-screens takeovers resolve real names and reach `ok`.
27. Indefinite takeover then Clear Takeover reverts immediately.
28. An unresolvable Duration fails with "Duration must be a whole number of minutes" instead of running indefinitely.
29. A screen omitted from a bulk takeover response (e.g. token lacks `apply_changes` on it) reports `takeover_failed` naming that screen.
30. Two takeover presses within a second: the second waits and each reports its own screens.

**Emergency alerts**

31. Broadcast a test alert by workspace and by screen group, with and without overrides; overrides take precedence.
32. A stale workspace ID fails with "No screens to target".
33. `last_alert_broadcast_hash` works with Cancel Broadcast, stopping only that broadcast; Cancel All stops every active one.
34. A bad alert ID or hash surfaces a clear error without clobbering `last_alert_broadcast_hash`; an unresolvable Duration or Find Media Workspace ID is rejected.
35. Record the real shape of `broadcast_screens` in a 201 response.
36. The **Refresh all screens**, **Clear all takeovers** and **Cancel all emergency broadcasts** presets work as one-press buttons with correct feedback.
