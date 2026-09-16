const BASE_URL = 'https://app.yodeck.com/api/v2'
const MAX_ATTEMPTS = 3

/** Ceiling on how many pages `getAllOfResource` will follow. The loop's real exit is `next: null`,
 *  but that's the server's word for it: a server that returns a non-null `next` without ever
 *  advancing (or that ignores `offset`) would spin it forever, inside an action callback or a
 *  background poll. At 100 rows a page this still covers 10 000 screens/playlists/etc. */
const MAX_LIST_PAGES = 100

/** Fallback wait when a 429 arrives without a usable `Retry-After`, and the longest we're willing to
 *  honor one for. A Companion action callback blocks the button while it runs, so sleeping out a
 *  multi-minute `Retry-After` is worse for the operator than failing with a clear rate-limit error. */
const RETRY_AFTER_DEFAULT_SECONDS = 2
const RETRY_AFTER_MAX_SECONDS = 30

/** How many media rows `findMedia` pulls back. Only the first is reported (plus the total `count`),
 *  so this is just enough to have a match in hand without fetching a whole library page. */
const FIND_MEDIA_LIMIT = 5

export type YodeckSourceType = 'media' | 'playlist' | 'layout' | 'schedule' | 'turned_off'

/** The `{id, name}` pair every list endpoint returns, and all this module reads from most of them. */
export interface YodeckRef {
	id: number
	name: string
}

export interface YodeckScreenSummary extends YodeckRef {
	online: boolean
}

export interface YodeckPushResult {
	status: 'successful' | 'failed'
	errors?: unknown
}

export interface YodeckPushStatus {
	status: 'initialized' | 'in_progress' | 'completed' | 'failed'
	progress?: { index: number; of: number; percent: number }
	screens?: YodeckRef[]
	errors?: unknown
}

interface RawMediaListPage {
	count: number
	results: YodeckRef[]
}

export type YodeckExceptionType = 'skip_on' | 'skip_from'

export interface YodeckEventExceptionResult {
	info: string
	note?: string
}

export type YodeckTakeoverSourceType = 'media' | 'playlist' | 'layout'

/** Takeover content for a screen; `null` clears an active takeover. */
export type YodeckTakeoverContent = {
	sourceId: number
	sourceType: YodeckTakeoverSourceType
	durationMinutes?: number
} | null

export interface YodeckTakeoverResult {
	status: 'success' | 'fail'
	errors?: unknown
}

export interface YodeckBulkTakeoverResult {
	/** Optional: callers cross-check against the screens they targeted, so a missing list must be representable. */
	screens?: Array<{ id: number; name: string; status: 'success' | 'fail'; errors?: unknown }>
}

export interface YodeckBroadcastResult {
	broadcast_hash: string
}

export class YodeckApiError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message)
		this.name = 'YodeckApiError'
	}
}

export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Builds a URL querystring from a flat params object, dropping undefined entries. */
function buildQueryString(params: Record<string, string | number | undefined>): string {
	const entries: [string, string][] = Object.entries(params)
		.filter((entry): entry is [string, string | number] => entry[1] !== undefined)
		.map(([k, v]) => [k, String(v)])
	const qs = new URLSearchParams(entries).toString()
	return qs ? `?${qs}` : ''
}

/** Reads a `Retry-After` header into a sane number of seconds. Yodeck documents the seconds form, but
 *  the header is also allowed to carry an HTTP-date, and `Number()` turns that into `NaN` — which
 *  `setTimeout` treats as 0, so an unguarded value would turn the backoff into three back-to-back
 *  retries against the very rate limiter that asked us to wait. */
function parseRetryAfter(header: string | null): number {
	const parsed = header !== null ? Number(header) : Number.NaN
	if (!Number.isFinite(parsed) || parsed <= 0) return RETRY_AFTER_DEFAULT_SECONDS
	return Math.min(parsed, RETRY_AFTER_MAX_SECONDS)
}

/** Wire form of a takeover's `takeover_content`. Undefined fields are dropped by `JSON.stringify`. */
function takeoverContentBody(content: YodeckTakeoverContent): Record<string, unknown> | null {
	if (!content) return null
	return { source_id: content.sourceId, source_type: content.sourceType, duration: content.durationMinutes }
}

/** Thin client for the Yodeck REST API. Only wraps the endpoints this module actually uses. */
export class YodeckApi {
	constructor(
		private readonly getAuthHeader: () => string,
		private readonly timeoutMs = 10_000,
	) {}

	private async request<T>(
		method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE',
		path: string,
		body?: unknown,
	): Promise<T> {
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			let res: Response
			try {
				res = await fetch(`${BASE_URL}${path}`, {
					method,
					headers: {
						Authorization: this.getAuthHeader(),
						Accept: 'application/json',
						...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
					},
					body: body !== undefined ? JSON.stringify(body) : undefined,
					signal: AbortSignal.timeout(this.timeoutMs),
				})
			} catch (e: unknown) {
				// Network-level failures (DNS, timeout, connection refused) are not retried.
				throw new YodeckApiError(e instanceof Error ? e.message : String(e))
			}

			if (res.status === 429) {
				const retryAfterSeconds = parseRetryAfter(res.headers.get('Retry-After'))
				if (attempt < MAX_ATTEMPTS) {
					await sleep(retryAfterSeconds * 1000)
					continue
				}
				throw new YodeckApiError('Rate limit exceeded', 429)
			}

			if (!res.ok) {
				let message = `HTTP ${res.status}`
				try {
					const errorBody = (await res.json()) as { error?: { message?: string; details?: unknown } }
					message = errorBody.error?.message ?? message
					// A 400's `message` is often generic ("Invalid request parameters."), with the actual
					// field-level reason only in `details` — fold it in so it reaches the *_error_message
					// variables instead of being dropped.
					const details = errorBody.error?.details
					if (details && typeof details === 'object' && Object.keys(details).length > 0) {
						message = `${message} ${JSON.stringify(details)}`
					}
				} catch {
					// Non-JSON error body — the status alone is enough.
				}
				throw new YodeckApiError(message, res.status)
			}

			if (res.status === 204) return undefined as T
			return (await res.json()) as T
		}
		// Unreachable — for loop always returns or throws on every iteration.
		throw new YodeckApiError('Unexpected code path')
	}

	/** Fetches one page of a DRF-style paginated list endpoint (`{next, results}`), mapping each row
	 *  through `mapRow`. (`/media` has the same shape, but `findMedia` only ever wants its first page.) */
	private async listPage<TRaw, TOut>(
		path: string,
		params: Record<string, string | number | undefined>,
		mapRow: (raw: TRaw) => TOut,
	): Promise<{ next: string | null; results: TOut[] }> {
		const page = await this.request<{ next: string | null; results: TRaw[] }>(
			'GET',
			`${path}${buildQueryString(params)}`,
		)
		return { next: page.next, results: page.results.map(mapRow) }
	}

	/** Follows pagination to collect every row of a `listPage`-shaped resource (optionally scoped to a workspace). */
	private async getAllOfResource<TRaw, TOut>(
		path: string,
		params: { workspace?: number },
		mapRow: (raw: TRaw) => TOut,
	): Promise<TOut[]> {
		const limit = 100
		const all: TOut[] = []
		// Advance by what the page actually returned and stop only on `next: null` (or an empty page):
		// if the server caps page size below `limit`, a short page is not the last one.
		let offset = 0
		for (let pages = 0; pages < MAX_LIST_PAGES; pages++) {
			const page = await this.listPage<TRaw, TOut>(path, { ...params, limit, offset }, mapRow)
			all.push(...page.results)
			if (!page.next || page.results.length === 0) return all
			offset += page.results.length
		}
		throw new YodeckApiError(`Gave up paginating ${path} after ${MAX_LIST_PAGES} pages`)
	}

	private static readonly mapScreenRow = (r: {
		id: number
		name: string
		state?: { online?: boolean }
	}): YodeckScreenSummary => ({
		id: r.id,
		name: r.name,
		online: r.state?.online ?? false,
	})

	/** Fetches a single page of screens. Only used to prove the token works during connection
	 *  verification — everything that actually needs screen data uses `getAllScreens`. */
	async getScreens(params: { limit?: number } = {}): Promise<{ next: string | null; results: YodeckScreenSummary[] }> {
		return this.listPage('/screens', params, YodeckApi.mapScreenRow)
	}

	/** Follows pagination to collect every screen (optionally scoped to a workspace). */
	async getAllScreens(params: { workspace?: number } = {}): Promise<YodeckScreenSummary[]> {
		return this.getAllOfResource('/screens', params, YodeckApi.mapScreenRow)
	}

	async setScreenContent(
		screenId: number,
		content: { source_type: YodeckSourceType; source_id?: number },
	): Promise<unknown> {
		return this.request('PATCH', `/screens/${screenId}`, { screen_content: content })
	}

	async pushScreen(screenId: number, useDownloadTimeslots: boolean): Promise<YodeckPushResult> {
		return this.request('POST', `/screens/${screenId}/push`, { use_download_timeslots: useDownloadTimeslots })
	}

	/** Omitting `filterDevices` pushes to every screen on the account. The endpoint's `filter_workspaces`
	 *  form is deliberately unused: callers resolve workspaces client-side so an empty one fails loudly. */
	async pushScreensBulk(opts: {
		useDownloadTimeslots: boolean
		filterDevices?: number[]
	}): Promise<{ push_status_url: string }> {
		// `[]` would either be a 400 or, if dropped, a push to every screen — neither is what a caller
		// that resolved zero screens wants.
		if (opts.filterDevices?.length === 0) {
			throw new YodeckApiError('Refusing to bulk push with an empty screen list')
		}
		return this.request('POST', '/screens/push', {
			use_download_timeslots: opts.useDownloadTimeslots,
			filter_devices: opts.filterDevices,
		})
	}

	async getPushStatus(): Promise<YodeckPushStatus> {
		return this.request('GET', '/screens/push/status')
	}

	// ─── Takeover ────────────────────────────────────────────────────────

	async takeoverScreen(
		screenId: number,
		content: YodeckTakeoverContent,
		useDownloadTimeslots: boolean,
	): Promise<YodeckTakeoverResult> {
		return this.request('PUT', `/screens/${screenId}/takeover`, {
			takeover_content: takeoverContentBody(content),
			use_download_timeslots: useDownloadTimeslots,
		})
	}

	async takeoverScreensBulk(
		screenIds: number[],
		content: YodeckTakeoverContent,
		useDownloadTimeslots: boolean,
	): Promise<YodeckBulkTakeoverResult> {
		return this.request('PUT', '/screens/takeover', {
			screens: screenIds.map((id) => ({ id, takeover_content: takeoverContentBody(content) })),
			use_download_timeslots: useDownloadTimeslots,
		})
	}

	// ─── Media ───────────────────────────────────────────────────────────

	async findMedia(params: { query?: string; tags?: string[]; workspace?: number }): Promise<{
		count: number
		results: YodeckRef[]
	}> {
		const qs = buildQueryString({
			q: params.query || undefined,
			tags: params.tags && params.tags.length > 0 ? params.tags.join(',') : undefined,
			workspace: params.workspace,
			limit: FIND_MEDIA_LIMIT,
		})
		const page = await this.request<RawMediaListPage>('GET', `/media${qs}`)
		return { count: page.count, results: page.results }
	}

	/** Strips each row down to `{id, name}`, so cache change-detection isn't thrown by unrelated fields. */
	private static readonly mapRefRow = (r: YodeckRef): YodeckRef => ({ id: r.id, name: r.name })

	// ─── Playlists ───────────────────────────────────────────────────────

	/** Follows pagination to collect every playlist. Note `/playlists` has no `workspace` filter. */
	async getAllPlaylists(): Promise<YodeckRef[]> {
		return this.getAllOfResource('/playlists', {}, YodeckApi.mapRefRow)
	}

	// ─── Layouts ─────────────────────────────────────────────────────────

	/** Follows pagination to collect every layout. */
	async getAllLayouts(): Promise<YodeckRef[]> {
		return this.getAllOfResource('/layouts', {}, YodeckApi.mapRefRow)
	}

	// ─── Schedules ───────────────────────────────────────────────────────

	/** Follows pagination to collect every schedule. */
	async getAllSchedules(): Promise<YodeckRef[]> {
		return this.getAllOfResource('/schedules', {}, YodeckApi.mapRefRow)
	}

	/** Applies a skip exception to an existing event within a schedule, without touching the rest of it. */
	async addScheduleEventException(
		scheduleId: number,
		eventId: number,
		type: YodeckExceptionType,
		date: string,
	): Promise<YodeckEventExceptionResult> {
		return this.request('PATCH', `/schedules/${scheduleId}/add-event-exception`, {
			event_id: eventId,
			exceptions: [type === 'skip_on' ? { skip_on: date } : { skip_from: date }],
		})
	}

	// ─── Emergency Alerts ────────────────────────────────────────────────

	/** Follows pagination to collect every emergency alert (read-only via the API; configured in Yodeck's UI). */
	async getAllEmergencyAlerts(): Promise<YodeckRef[]> {
		return this.getAllOfResource('/emergency-alerts', {}, YodeckApi.mapRefRow)
	}

	/** Follows pagination to collect every broadcast screen group (also read-only via the API). */
	async getAllBroadcastScreenGroups(): Promise<YodeckRef[]> {
		return this.getAllOfResource('/emergency-alerts/broadcast-screen-groups', {}, YodeckApi.mapRefRow)
	}

	/** Broadcasts an existing emergency alert now. Any of headline/description/instruction/duration
	 *  left undefined falls back to the alert's own configured defaults. */
	async broadcastEmergencyAlert(
		alertId: number,
		opts: {
			headline?: string
			description?: string
			instruction?: string
			durationSeconds?: number
			workspace?: number
			broadcastScreenGroup?: number
		},
	): Promise<YodeckBroadcastResult> {
		// Undefined fields are dropped by JSON.stringify, so Yodeck falls back to the alert's own defaults.
		return this.request('POST', `/emergency-alerts/${alertId}/broadcast`, {
			headline: opts.headline,
			description: opts.description,
			instruction: opts.instruction,
			duration: opts.durationSeconds,
			workspace: opts.workspace,
			broadcast_screen_group: opts.broadcastScreenGroup,
		})
	}

	async cancelAllBroadcasts(): Promise<void> {
		await this.request('DELETE', '/emergency-alerts/broadcasts')
	}

	/** The hash is operator-supplied (typically via a variable), so it's percent-encoded before going
	 *  into the path: an unescaped value containing `/..` would resolve to `/emergency-alerts/broadcasts/`
	 *  and cancel *every* active broadcast instead of the one asked for. */
	async cancelBroadcast(hash: string): Promise<void> {
		await this.request('DELETE', `/emergency-alerts/broadcasts/${encodeURIComponent(hash)}`)
	}
}
