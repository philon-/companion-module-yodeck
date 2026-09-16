# companion-module-yodeck

A [Bitfocus Companion](https://bitfocus.io/companion) module for controlling [Yodeck](https://www.yodeck.com/) digital signage screens through Yodeck's REST API.

> ⚠️ **AI-generated and untested against a real Yodeck account.** Review and test it yourself before using it on a live signage network. See [ROADMAP.md](./ROADMAP.md) for verification status.

Supported: pushing content (media, playlists, layouts, schedules) to one or many screens, refreshing screens, finding media by name/tag, adding skip exceptions to schedule events, temporary screen takeovers, and broadcasting/cancelling emergency alerts. One-off admin tasks (uploading media, editing playlists/layouts/schedules, webhooks) are intentionally left to Yodeck's web UI.

- [companion/HELP.md](./companion/HELP.md) — end-user setup and usage
- [ROADMAP.md](./ROADMAP.md) — status, scope, API notes, verification checklist
- [CLAUDE.md](./CLAUDE.md) — development conventions

## Development

- `yarn` — install dependencies
- `yarn build` — build once (enough for Companion to load the module)
- `yarn dev` — rebuild on change
- `yarn lint` / `yarn format`
