## Yodeck

Control [Yodeck](https://www.yodeck.com/) digital signage screens from Companion: push new content to a screen (or many screens at once), force a refresh of whatever content is already assigned, find existing media, add skip exceptions to schedule events, temporarily take over screens with override content, and broadcast or cancel emergency alerts.

### Requirements

- A Yodeck account on a plan with API access (Premium or Enterprise).
- An API token, created in Yodeck under **Account Settings → Advanced Settings → API Tokens**. Creating a token gives you a **label** and a secret **value** — you'll need both.

### Configuration

Enter the token's label in **API Token Label** and its secret value in **API Token Value**. The connection status will show **Connecting** and then either **OK** or an error describing what's wrong (bad token, insufficient permissions, no network, etc.).

### Actions

**Push New Content to Screen(s)** — assigns new content to a screen and immediately pushes it there.

- **Target**: a single screen, multiple screens (comma-separated IDs), or every screen in a workspace. **Single Screen** takes exactly one ID — a comma-separated list there is rejected rather than partly ignored, so use Multiple Screens for that (the same applies to Refresh Screen(s) and Take Over Screen(s)). Every entry in a Screen ID field must be a whole number; if any of them isn't (typically a variable that didn't resolve at press time), the whole action is rejected rather than pushing to the entries that did parse.
- **Content Type**: Media, Playlist, Layout, Schedule, or Turn Screen Off.
- **Content ID**: the numeric ID of the media/playlist/layout/schedule to show (not needed for Turn Screen Off; for every other type a Content ID that is blank, or that isn't a whole number, is rejected before anything is sent to Yodeck — a partly-numeric value such as `7-holiday` is refused rather than read as `7`). The same whole-number rule applies to the Workspace ID field, and to the Schedule/Event ID fields in Add Schedule Event Exception. For Playlist, Layout, and Schedule, this is a searchable dropdown populated from a background list refresh (roughly every 5 minutes); a raw ID or variable expression can still be typed in directly, so a change made directly in Yodeck's web app doesn't have to wait for the refresh. Media remains free text.
- **Respect download timeslots**: if enabled, the screen downloads the new content during its configured timeslot instead of immediately.

Screen, workspace, and content IDs are visible in Yodeck's web app (e.g. in a screen or media item's URL), or via the API's list endpoints.

**Refresh Screen(s)** — re-delivers whatever content is _already_ assigned to a screen, without changing it. Useful when a screen looks stale and you just want it to re-check in. Target can be a single screen, a specific list of screens, every screen in a workspace, or all screens on the account.

Pushing to multiple screens happens in the background: content is assigned to each screen (a few at a time, to stay inside Yodeck's rate limit), then delivery is kicked off for all of them together, and the module polls Yodeck for up to a minute for the result. The push only counts as successful if Yodeck reports every targeted screen as having received it; a "completed" result that doesn't name a targeted screen is treated as a failure for that screen, not waved through.

Yodeck tracks only one bulk push at a time per account, and the `last_push_*` variables below are shared by both push actions, so the module runs push and refresh attempts strictly one after another. If you press a second push/refresh button while one is still running, it waits its turn — up to the one-minute poll timeout of the attempt ahead of it — rather than overlapping with it and reporting the wrong screens' outcome.

**Find Media** — looks up existing media by name and/or tags and stores the first match in variables, so you don't have to know a Content ID by heart to push it.

- **Name Contains**: a partial, case-insensitive match against the media's name.
- **Tags (optional)**: comma-separated tags — only media with at least one of these tags is returned.
- **Workspace ID (optional)**: restrict the search to one workspace. Leave it blank to search every workspace; a value that isn't a whole number is rejected rather than quietly searching them all.

At least one of these three must be filled in — a search with all of them blank would match the whole media library and report an arbitrary item as "the" match, so it's rejected instead.

**Add Schedule Event Exception** — skips a specific occurrence, or all future occurrences, of an event that's already part of a schedule (for example, a "Skip Today" button for a holiday closure). This module doesn't create or edit schedules or their events — that's done in Yodeck's own web app — only exceptions on events that already exist there. Find the numeric Event ID in Yodeck's UI when editing the schedule.

- **Schedule**: a searchable dropdown populated from a background list refresh (roughly every 5 minutes); a raw ID or variable expression can still be typed in directly.
- **Event ID**: the event's numeric ID, from Yodeck's UI.
- **Exception Type**: "Skip This Date" skips a single occurrence; "Skip From This Date Onward" stops all occurrences from that date forward.
- **Date**: the date the exception applies to, in `YYYY-MM-DD` format.

Depending on the exception and the event's recurrence, Yodeck may remove the event from the schedule entirely (for example, a "Skip From" date on or before a non-recurring event's start date) — when that happens, Yodeck's explanation is captured in the `last_schedule_exception_info` variable.

**Take Over Screen(s)** — temporarily overrides one, several, or all screens with different content, without changing what they're normally assigned to show. Useful as a "panic button" for a short-notice announcement, or to force a specific screen to show something else for a while. A multi-screen takeover only counts as successful if Yodeck reports every targeted screen as taken over — a screen the response leaves out entirely is reported as a failure, not assumed to have worked.

Takeover attempts are queued one after another, the same way push/refresh attempts are, because they share the `last_takeover_*` variables below. Pressing a second takeover button while one is still resolving its targets makes it wait its turn rather than overwriting the first attempt's reported screens mid-flight.

- **Target**: a single screen, specific screens (comma-separated IDs), every screen in a workspace, or all screens.
- **Content Type**: Media, Playlist, Layout, or Clear Takeover. Media is free text; Playlist and Layout are searchable dropdowns (same cache as Push New Content to Screen(s)). Schedules can't be used for takeover content — that's a Yodeck API limitation, not a module one.
- **Duration in Minutes (optional)**: minimum 5 minutes; leave blank to run indefinitely, until cleared. Because blank means _indefinite_, a value that isn't a whole number is rejected rather than treated as blank — otherwise a duration coming from a variable that didn't resolve would leave the screens overridden until someone noticed.
- **Clear Takeover**: pick this as the Content Type to immediately end an active takeover early and let the screen(s) go back to showing what they're normally assigned.
- **Respect download timeslots**: same meaning as in Push New Content to Screen(s).

**Broadcast Emergency Alert** — immediately broadcasts an existing emergency alert to screens. Emergency alerts themselves (their category, headline, description, instructions) are configured in Yodeck's own web app; this module can only trigger and cancel broadcasts of alerts that already exist there.

- **Emergency Alert**: a searchable dropdown of existing alerts, populated from a background list refresh (roughly every 5 minutes).
- **Target**: all permitted screens, a workspace, or a broadcast screen group (also a searchable dropdown, configured in Yodeck's UI).
- **Headline/Description/Instruction Override (optional)**: leave blank to use the alert's own configured text.
- **Duration in Seconds (optional)**: defaults to 7200 (2 hours) if left blank. A value that isn't a whole number is rejected rather than falling back to that default.

After a successful broadcast, its `broadcast_hash` is stored in the `last_alert_broadcast_hash` variable, for use with **Cancel Broadcast** below.

**Cancel All Emergency Broadcasts** — immediately cancels every active emergency alert broadcast, across all screens. No options — a good fit for a single "all clear" button.

**Cancel Broadcast** — cancels one specific active emergency alert broadcast by its hash, leaving any other active broadcast untouched.

- **Broadcast Hash**: typically `$(yodeck:last_alert_broadcast_hash)` to cancel the broadcast this module most recently started, or a hash found via Yodeck's UI.

### Variables

- `last_push_status` — `ok`, `failed`, or `never` (before the first attempt).
- `last_push_targets` — the screen ID(s) targeted by the most recent action. A workspace target is resolved to the IDs of the screens in it; only Refresh Screen(s)' "All Screens" target shows a label (`all screens`) instead.
- `last_push_target_names` — the same targets, resolved to screen names where known.
- `last_push_time` — when the most recent action ran. The target variables above are cleared at the start of each attempt, so an attempt that fails before resolving its targets (e.g. a missing workspace ID) leaves them blank rather than showing an earlier attempt's screens.
- `last_push_progress` — progress of an in-flight multi-screen push (e.g. `3 of 5 (60%)`).
- `last_push_error_message` — the error from the most recent failed attempt, if any.
- `screens_online_count` / `screens_total_count` — how many of the account's screens are currently online, refreshed about once a minute.
- `found_media_status` — `ok`, `failed`, or `never`, for the most recent Find Media attempt.
- `found_media_id` / `found_media_name` — the first match from the most recent Find Media action.
- `found_media_count` — the total number of matches from the most recent Find Media action.
- `found_media_time` — when the most recent Find Media attempt ran.
- `found_media_error_message` — the error from the most recent failed Find Media attempt, if any.
- `last_schedule_exception_status` — `ok`, `failed`, or `never`, for the most recent Add Schedule Event Exception attempt.
- `last_schedule_exception_time` — when the most recent attempt ran.
- `last_schedule_exception_error_message` — the error from the most recent failed attempt, if any.
- `last_schedule_exception_info` — Yodeck's info/note message from the most recent successful attempt (e.g. noting that the event was removed from the schedule as a result).
- `last_takeover_status` — `ok`, `failed`, or `never`, for the most recent Take Over Screen(s) attempt.
- `last_takeover_targets` / `last_takeover_target_names` — the screen ID(s) targeted by the most recent takeover attempt (workspace and "all screens" targets are resolved to the actual screen IDs), and the same resolved to screen names where known.
- `last_takeover_time` — when the most recent takeover attempt ran (the takeover target variables are cleared at the start of each attempt, like the push ones).
- `last_takeover_error_message` — the error from the most recent failed takeover attempt, if any.
- `last_alert_broadcast_status` — `ok`, `failed`, or `never`, for the most recent Broadcast/Cancel Emergency Alert attempt (all three emergency-alert actions share this status).
- `last_alert_broadcast_hash` — the `broadcast_hash` returned by the most recent successful Broadcast Emergency Alert attempt. A failed broadcast leaves it alone, so it stays usable with **Cancel Broadcast**. It is cleared once **Cancel Broadcast** successfully cancels that same hash, since a cancelled broadcast can't be cancelled again; **Cancel All Emergency Broadcasts**, and cancelling some other hand-entered hash, leave it alone.
- `last_alert_broadcast_time` — when the most recent broadcast/cancel attempt ran.
- `last_alert_broadcast_error_message` — the error from the most recent failed attempt, if any.

### Feedbacks

- **Last push succeeded** / **Last push failed** — reflect the outcome of the most recent push/refresh action, so a button can change color after it runs.
- **Screen is online** — true while the given Screen ID last reported itself online. Refreshed about once a minute in the background, so it can lag reality slightly.
- **Last Find Media succeeded** / **Last Find Media failed** — reflect the outcome of the most recent Find Media action.
- **Last schedule event exception succeeded** / **Last schedule event exception failed** — reflect the outcome of the most recent Add Schedule Event Exception action.
- **Last takeover succeeded** / **Last takeover failed** — reflect the outcome of the most recent Take Over Screen(s) action.
- **Last emergency alert operation succeeded** / **Last emergency alert operation failed** — reflect the outcome of the most recent Broadcast Emergency Alert, Cancel All Emergency Broadcasts, or Cancel Broadcast action (all three share this pair).

### Connection status

The connection status is checked when the module starts or its configuration is saved, and then by the background screen-status refresh about once a minute. A revoked token flips it to an error on the next refresh; once requests succeed again (for example, Companion started before the network was up), it goes back to **OK** by itself.

The five dropdown caches (playlists, layouts, schedules, emergency alerts, broadcast screen groups) are refreshed independently of each other. If your plan or token doesn't cover one of them — emergency alerts, typically — that one dropdown stays empty and the rest keep working, and a single unavailable list doesn't by itself mark the connection as failed.

### Rate limits

Yodeck rate-limits the API per token and per account. Pushing to a large number of screens at once, or firing many buttons in quick succession, can hit that limit. The module automatically retries a rate-limited request a couple of times (honoring Yodeck's `Retry-After` header, up to 30 seconds per wait) before giving up — if it still fails, the action reports it via its own error-message variable (`last_push_error_message`, `last_takeover_error_message`, and so on).
