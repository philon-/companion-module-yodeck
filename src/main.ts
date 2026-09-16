import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import {
	sleep,
	YodeckApi,
	YodeckApiError,
	type YodeckExceptionType,
	type YodeckPushStatus,
	type YodeckRef,
	type YodeckScreenSummary,
	type YodeckSourceType,
	type YodeckTakeoverContent,
	type YodeckTakeoverSourceType,
} from './yodeck-api.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

/** Screen targets. Single/Multiple/Specific come with `screenIds` (`null` when the field held
 *  something that isn't a whole number); Workspace comes with `workspaceId`. */
type ScreenTarget = 'single' | 'multiple' | 'specific' | 'workspace' | 'all'

interface TargetOptions<T extends ScreenTarget> {
	target: T
	screenIds: number[] | null
	workspaceId: number | undefined
}

export interface PushContentOptions extends TargetOptions<'single' | 'multiple' | 'workspace'> {
	sourceType: YodeckSourceType
	sourceId: number | undefined
	useDownloadTimeslots: boolean
}

export interface RefreshScreensOptions extends TargetOptions<'single' | 'specific' | 'workspace' | 'all'> {
	useDownloadTimeslots: boolean
}

export interface TakeoverOptions extends TargetOptions<'single' | 'specific' | 'workspace' | 'all'> {
	sourceType: YodeckTakeoverSourceType | 'clear_takeover'
	sourceId: number | undefined
	/** `null` = filled in but not a whole number (as opposed to blank, which means indefinite). */
	durationMinutes: number | undefined | null
	useDownloadTimeslots: boolean
}

/** How long to keep polling a bulk push before giving up on it. */
const PUSH_POLL_TIMEOUT_MS = 60_000
const PUSH_POLL_INTERVAL_MS = 2_000

/** How many per-screen content assignments a multi-screen push runs at once. */
const ASSIGN_CONCURRENCY = 4

/** How often to refresh the online/offline status of every screen in the account. */
const STATUS_POLL_INTERVAL_MS = 60_000

/** How often to refresh the cached playlist/layout lists used to populate dropdown pickers.
 *  Much less frequent than screen status: this data changes rarely and driving it too often
 *  would mean needless updateActions() rebuilds (which have a real UI cost) most of the time. */
const LIST_POLL_INTERVAL_MS = 300_000

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	secrets!: ModuleSecrets // Setup in init()

	/** Outcome of the most recent push/refresh action. Read by the push_succeeded/push_failed feedbacks. */
	lastPushOk: boolean | undefined

	/** Outcome of the most recent Find Media attempt. Read by the find_media_succeeded/failed feedbacks. */
	lastFindMediaOk: boolean | undefined

	/** Outcome of the most recent Add Schedule Event Exception attempt. Read by the
	 *  schedule_exception_succeeded/failed feedbacks. */
	lastScheduleExceptionOk: boolean | undefined

	/** Outcome of the most recent Take Over Screen(s) attempt. Read by the
	 *  takeover_succeeded/failed feedbacks. */
	lastTakeoverOk: boolean | undefined

	/** Outcome of the most recent broadcast/cancel emergency-alert attempt (shared by all three
	 *  emergency-alert actions). Read by the alert_broadcast_succeeded/failed feedbacks. */
	lastAlertBroadcastOk: boolean | undefined

	/** Latest known online/offline state of every screen, refreshed on a timer. Read by the screen_online feedback. */
	screens = new Map<number, YodeckScreenSummary>()

	/** Cached playlist/layout/schedule/emergency-alert/broadcast-screen-group lists, refreshed on a
	 *  timer. Used to populate dropdown choices in updateActions() since this base version has no
	 *  live/async choices mechanism. */
	playlists = new Map<number, YodeckRef>()
	layouts = new Map<number, YodeckRef>()
	schedules = new Map<number, YodeckRef>()
	emergencyAlerts = new Map<number, YodeckRef>()
	broadcastScreenGroups = new Map<number, YodeckRef>()

	private api!: YodeckApi
	private destroyed = false
	private statusPollTimer: ReturnType<typeof setInterval> | null = null
	private listPollTimer: ReturnType<typeof setInterval> | null = null

	/** Runs whole push/refresh attempts one at a time. Every attempt shares the `last_push_*`
	 *  variables, the account-wide `GET /screens/push/status` record (which has no per-push ID), and
	 *  the screens' assigned content that a bulk push delivers — so overlapping attempts could report
	 *  each other's outcome or ship each other's content. */
	private readonly pushQueue = new SerialQueue()

	/** Same for takeovers, which share the `last_takeover_*` variables (reporting only — each takeover
	 *  call carries its own content and screen list). */
	private readonly takeoverQueue = new SerialQueue()

	/** Stop a background poll overlapping itself: a paginated, rate-limited `getAllScreens()` can
	 *  outlast the 60s tick, and an older result landing last would clobber the newer cache. */
	private statusPollInFlight = false
	private listPollInFlight = false

	/** The `broadcast_hash` of the broadcast this instance most recently started, mirroring the
	 *  `last_alert_broadcast_hash` variable so Cancel Broadcast can tell "the hash we're tracking"
	 *  from a hand-entered one. */
	private lastBroadcastHash = ''

	/** Whether the connection status currently reads Ok, so a successful background poll can restore
	 *  it after a failure (startup with no network yet, a transient 401) without re-sending Ok every tick. */
	private connectionOk = false

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.secrets = secrets
		this.api = new YodeckApi(() => `Token ${this.config.tokenLabel}:${this.secrets.apiToken}`)

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updatePresets() // export Presets
		this.updateVariableDefinitions() // export variable definitions

		this.setVariableValues({
			last_push_status: 'never',
			last_push_targets: '',
			last_push_target_names: '',
			last_push_time: '',
			last_push_progress: '',
			last_push_error_message: '',
			screens_online_count: '',
			screens_total_count: '',
			found_media_status: 'never',
			found_media_id: '',
			found_media_name: '',
			found_media_count: '',
			found_media_time: '',
			found_media_error_message: '',
			last_schedule_exception_status: 'never',
			last_schedule_exception_time: '',
			last_schedule_exception_error_message: '',
			last_schedule_exception_info: '',
			last_takeover_status: 'never',
			last_takeover_targets: '',
			last_takeover_target_names: '',
			last_takeover_time: '',
			last_takeover_error_message: '',
			last_alert_broadcast_status: 'never',
			last_alert_broadcast_hash: '',
			last_alert_broadcast_time: '',
			last_alert_broadcast_error_message: '',
		})

		await this.connect()
	}

	// When module gets deleted
	async destroy(): Promise<void> {
		this.destroyed = true
		this.stopStatusPolling()
		this.stopListPolling()
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.secrets = secrets
		await this.connect()
	}

	// Return config fields for web config
	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	// ─── Connection verification ────────────────────────────────────────

	/** (Re)verifies the connection and (re)starts both background polls. */
	private async connect(): Promise<void> {
		this.stopStatusPolling()
		this.stopListPolling()
		this.updateStatus(InstanceStatus.Connecting)
		await this.verifyConnection()
		this.startStatusPolling()
		this.startListPolling()
	}

	private async verifyConnection(): Promise<void> {
		this.connectionOk = false
		if (!this.config.tokenLabel || !this.secrets.apiToken) {
			this.updateStatus(InstanceStatus.BadConfig, 'API token label and value are required')
			return
		}

		try {
			await this.api.getScreens({ limit: 1 })
			this.markConnectionOk()
		} catch (e: unknown) {
			this.updateStatus(...statusForError(e))
		}
	}

	private markConnectionOk(): void {
		if (this.connectionOk) return
		this.connectionOk = true
		this.updateStatus(InstanceStatus.Ok)
	}

	// ─── Screen status polling ───────────────────────────────────────────

	private startStatusPolling(): void {
		void this.refreshScreenStatus()
		this.statusPollTimer = setInterval(() => void this.refreshScreenStatus(), STATUS_POLL_INTERVAL_MS)
	}

	private stopStatusPolling(): void {
		if (this.statusPollTimer) {
			clearInterval(this.statusPollTimer)
			this.statusPollTimer = null
		}
	}

	/** Refreshes the cached online/offline state of every screen. Transient failures are only logged,
	 *  but an auth failure flips connection status (this poll is usually first to notice a revoked
	 *  token), and a success restores Ok (e.g. after Companion started before the network was up). */
	private async refreshScreenStatus(): Promise<void> {
		if (!this.config.tokenLabel || !this.secrets.apiToken) return
		if (this.statusPollInFlight) return
		this.statusPollInFlight = true

		try {
			const screens = await this.api.getAllScreens()
			this.markConnectionOk()
			this.screens = new Map(screens.map((s) => [s.id, s]))
			this.setVariableValues({
				screens_online_count: String(screens.filter((s) => s.online).length),
				screens_total_count: String(screens.length),
			})
			this.checkFeedbacks('screen_online')
		} catch (e: unknown) {
			this.log('debug', `Screen status refresh failed: ${errorMessage(e)}`)
			this.flagIfAuthFailure(e)
		} finally {
			this.statusPollInFlight = false
		}
	}

	private screenLabel(id: number): string {
		return this.screens.get(id)?.name ?? String(id)
	}

	// ─── Playlist/layout list polling ───────────────────────────────────

	private startListPolling(): void {
		void this.refreshContentLists()
		this.listPollTimer = setInterval(() => void this.refreshContentLists(), LIST_POLL_INTERVAL_MS)
	}

	private stopListPolling(): void {
		if (this.listPollTimer) {
			clearInterval(this.listPollTimer)
			this.listPollTimer = null
		}
	}

	/** Refreshes the cached lists behind the dropdown pickers, rebuilding action definitions only when
	 *  one actually changed (that rebuild has a real UI cost). Each list is fetched independently, so
	 *  one the plan or token doesn't cover (typically emergency alerts) doesn't empty the others. */
	private async refreshContentLists(): Promise<void> {
		if (!this.config.tokenLabel || !this.secrets.apiToken) return
		if (this.listPollInFlight) return
		this.listPollInFlight = true

		try {
			const results = await Promise.allSettled([
				this.api.getAllPlaylists(),
				this.api.getAllLayouts(),
				this.api.getAllSchedules(),
				this.api.getAllEmergencyAlerts(),
				this.api.getAllBroadcastScreenGroups(),
			])
			const [playlists, layouts, schedules, emergencyAlerts, broadcastScreenGroups] = results

			let changed = false
			const apply = (result: PromiseSettledResult<YodeckRef[]>, cache: Map<number, YodeckRef>) => {
				if (result.status === 'rejected') {
					this.log('debug', `Content list refresh failed: ${errorMessage(result.reason)}`)
					return cache
				}
				changed = contentListChanged(cache, result.value) || changed
				return new Map(result.value.map((r) => [r.id, r]))
			}
			this.playlists = apply(playlists, this.playlists)
			this.layouts = apply(layouts, this.layouts)
			this.schedules = apply(schedules, this.schedules)
			this.emergencyAlerts = apply(emergencyAlerts, this.emergencyAlerts)
			this.broadcastScreenGroups = apply(broadcastScreenGroups, this.broadcastScreenGroups)
			if (changed) this.updateActions()

			// Only a wholesale failure looks like a revoked token. One list failing alone is a per-resource
			// plan/permission gap, and flagging it would fight the screen poll's Ok every minute.
			const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
			if (rejected.length === results.length) this.flagIfAuthFailure(rejected[0].reason)
		} catch (e: unknown) {
			this.log('debug', `Content list refresh failed: ${errorMessage(e)}`)
			this.flagIfAuthFailure(e)
		} finally {
			this.listPollInFlight = false
		}
	}

	/** Builds the last_*_targets/last_*_target_names variable values for a list of screen IDs. */
	private describeTargets(screenIds: number[]): { ids: string; names: string } {
		return { ids: screenIds.join(', '), names: screenIds.map((id) => this.screenLabel(id)).join(', ') }
	}

	/** Resolves a workspace (or, with no ID, the whole account) to its screen IDs, failing on an empty
	 *  result so a stale/mistyped workspace ID can't report success after touching zero screens. */
	private async resolveScreens(workspaceId?: number): Promise<number[]> {
		const screenIds = (await this.api.getAllScreens({ workspace: workspaceId })).map((s) => s.id)
		if (screenIds.length === 0) {
			throw new YodeckApiError(
				workspaceId === undefined ? 'No screens to target' : 'No screens to target (check the workspace ID)',
			)
		}
		return screenIds
	}

	// ─── Media ───────────────────────────────────────────────────────────

	async findMedia(opts: { query: string; tags: string[]; workspaceId: number | undefined | null }): Promise<void> {
		this.setVariableValues({ found_media_time: new Date().toISOString() })

		try {
			// Junk in the Workspace ID must not quietly widen the search to the whole account, and an
			// all-blank search would report an arbitrary item as "the" match.
			if (opts.workspaceId === null) {
				throw new YodeckApiError('Workspace ID must be a whole number (leave it blank to search every workspace)')
			}
			if (!opts.query && opts.tags.length === 0 && opts.workspaceId === undefined) {
				throw new YodeckApiError('Enter a name, tag(s), or a workspace ID to search for')
			}

			const result = await this.api.findMedia({
				query: opts.query || undefined,
				tags: opts.tags,
				workspace: opts.workspaceId,
			})
			const first: YodeckRef | undefined = result.results[0]
			this.lastFindMediaOk = true
			this.setVariableValues({
				found_media_status: 'ok',
				found_media_count: String(result.count),
				found_media_id: first ? String(first.id) : '',
				found_media_name: first ? first.name : '',
				found_media_error_message: '',
			})
			if (!first) {
				this.log('info', 'Find media: no matches')
			}
			this.checkFeedbacks('find_media_succeeded', 'find_media_failed')
		} catch (e: unknown) {
			this.lastFindMediaOk = false
			const message = errorMessage(e)
			this.log('warn', `Find media failed: ${message}`)
			this.setVariableValues({
				found_media_status: 'failed',
				found_media_count: '',
				found_media_id: '',
				found_media_name: '',
				found_media_error_message: message,
			})
			this.checkFeedbacks('find_media_succeeded', 'find_media_failed')
			this.flagIfAuthFailure(e)
		}
	}

	// ─── Schedules ───────────────────────────────────────────────────────

	async addScheduleEventException(opts: {
		scheduleId: number | undefined
		eventId: number | undefined
		exceptionType: YodeckExceptionType
		date: string
	}): Promise<void> {
		this.setVariableValues({ last_schedule_exception_time: new Date().toISOString(), last_schedule_exception_info: '' })

		try {
			if (opts.scheduleId === undefined) throw new YodeckApiError('No schedule selected')
			if (opts.eventId === undefined) throw new YodeckApiError('No event ID provided')
			if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new YodeckApiError('Date must be in YYYY-MM-DD format')

			const result = await this.api.addScheduleEventException(
				opts.scheduleId,
				opts.eventId,
				opts.exceptionType,
				opts.date,
			)
			this.lastScheduleExceptionOk = true
			this.setVariableValues({
				last_schedule_exception_status: 'ok',
				last_schedule_exception_info: result.note ?? result.info,
				last_schedule_exception_error_message: '',
			})
			this.checkFeedbacks('schedule_exception_succeeded', 'schedule_exception_failed')
		} catch (e: unknown) {
			this.lastScheduleExceptionOk = false
			const message = errorMessage(e)
			this.log('warn', `Add schedule event exception failed: ${message}`)
			this.setVariableValues({
				last_schedule_exception_status: 'failed',
				last_schedule_exception_error_message: message,
			})
			this.checkFeedbacks('schedule_exception_succeeded', 'schedule_exception_failed')
			this.flagIfAuthFailure(e)
		}
	}

	// ─── Pushing content ─────────────────────────────────────────────────

	async pushContentToScreens(opts: PushContentOptions): Promise<void> {
		return this.pushQueue.run(async () => this.pushContentToScreensInner(opts))
	}

	private async pushContentToScreensInner(opts: PushContentOptions): Promise<void> {
		const { target, sourceType, sourceId, useDownloadTimeslots } = opts
		this.beginPushAttempt()

		try {
			const optionScreenIds = checkTargetInputs(opts)
			// Checked before target resolution: a blank Content ID must never reach PATCH /screens/{id}.
			if (sourceType !== 'turned_off' && sourceId === undefined) {
				throw new YodeckApiError('No content ID provided')
			}

			const screenIds = target === 'workspace' ? await this.resolveScreens(opts.workspaceId) : optionScreenIds
			const { ids, names } = this.describeTargets(screenIds)
			this.setVariableValues({ last_push_targets: ids, last_push_target_names: names })

			const content =
				sourceType === 'turned_off'
					? ({ source_type: sourceType } as const)
					: { source_type: sourceType, source_id: sourceId }

			if (screenIds.length === 1) {
				const screenId = screenIds[0]
				await this.api.setScreenContent(screenId, content)
				const result = await this.api.pushScreen(screenId, useDownloadTimeslots)
				if (result.status !== 'successful') {
					throw new YodeckApiError(`Push failed for screen ${screenId}: ${JSON.stringify(result.errors ?? {})}`)
				}
			} else {
				// Bounded concurrency: screens endpoints allow ~21 requests/10s per token, and an unbounded
				// burst would have most requests 429, retry, and exhaust their retries together.
				const outcomes = await mapSettledLimited(screenIds, ASSIGN_CONCURRENCY, async (screenId) =>
					this.api.setScreenContent(screenId, content),
				)
				const failures = screenIds.flatMap((screenId, i) => {
					const outcome = outcomes[i]
					return outcome.status === 'rejected' ? [`${screenId}: ${errorMessage(outcome.reason)}`] : []
				})
				if (failures.length > 0) {
					const assigned = screenIds.length - failures.length
					throw new YodeckApiError(
						`Failed to assign content to screen(s): ${failures.join('; ')}` +
							(assigned > 0 ? ` (${assigned} other screen(s) were assigned the content but not pushed)` : ''),
					)
				}

				await this.runBulkPush(screenIds, useDownloadTimeslots)
			}

			this.reportPushSuccess()
		} catch (e: unknown) {
			this.reportPushFailure(e)
		}
	}

	async refreshScreens(opts: RefreshScreensOptions): Promise<void> {
		return this.pushQueue.run(async () => this.refreshScreensInner(opts))
	}

	private async refreshScreensInner(opts: RefreshScreensOptions): Promise<void> {
		const { target, useDownloadTimeslots } = opts
		this.beginPushAttempt()

		try {
			const optionScreenIds = checkTargetInputs(opts)

			if (target === 'single') {
				const screenId = optionScreenIds[0]
				this.setVariableValues({
					last_push_targets: String(screenId),
					last_push_target_names: this.screenLabel(screenId),
				})
				const result = await this.api.pushScreen(screenId, useDownloadTimeslots)
				if (result.status !== 'successful') {
					throw new YodeckApiError(`Refresh failed for screen ${screenId}: ${JSON.stringify(result.errors ?? {})}`)
				}
			} else if (target === 'all') {
				// The endpoint's native no-filter form, so there's no screen list to name or cross-check,
				// and fetching the whole account's screens just for that isn't worth a call per press.
				this.setVariableValues({ last_push_targets: 'all screens', last_push_target_names: 'all screens' })
				await this.runBulkPush(undefined, useDownloadTimeslots)
			} else {
				const screenIds = target === 'workspace' ? await this.resolveScreens(opts.workspaceId) : optionScreenIds
				const { ids, names } = this.describeTargets(screenIds)
				this.setVariableValues({ last_push_targets: ids, last_push_target_names: names })
				await this.runBulkPush(screenIds, useDownloadTimeslots)
			}

			this.reportPushSuccess()
		} catch (e: unknown) {
			this.reportPushFailure(e)
		}
	}

	/** Stamps the start of a push/refresh attempt and clears the previous attempt's targets, so an
	 *  early failure doesn't leave `failed` beside another attempt's screens. */
	private beginPushAttempt(): void {
		this.setVariableValues({
			last_push_time: new Date().toISOString(),
			last_push_targets: '',
			last_push_target_names: '',
			last_push_progress: '',
		})
	}

	/** Kicks off a bulk push (`filterDevices` undefined = every screen on the account) and follows it
	 *  to its conclusion. Only call inside a `pushQueue` attempt. */
	private async runBulkPush(filterDevices: number[] | undefined, useDownloadTimeslots: boolean): Promise<void> {
		await this.api.pushScreensBulk({ filterDevices, useDownloadTimeslots })
		await this.pollPushStatus(filterDevices)
	}

	/** Polls until the bulk push completes. `expectedScreenIds`, when known, must all appear in the
	 *  `completed` response's `screens` list. */
	private async pollPushStatus(expectedScreenIds?: number[]): Promise<void> {
		const deadline = Date.now() + PUSH_POLL_TIMEOUT_MS

		while (!this.destroyed && Date.now() < deadline) {
			// Wait before the first check too, so we don't read the previous push's final state.
			await sleep(PUSH_POLL_INTERVAL_MS)
			if (this.destroyed) break

			let status: YodeckPushStatus
			try {
				status = await this.api.getPushStatus()
			} catch (e: unknown) {
				// A transient hiccup mid-poll shouldn't fail the whole push; keep polling until the deadline.
				this.log('debug', `Push status check failed, will retry: ${errorMessage(e)}`)
				continue
			}

			if (status.status === 'completed') {
				// `screens` lists the screens that actually received the content — screens the token can't
				// push to are silently dropped — and checking IDs (not counts) also catches a `completed`
				// left over from another push. A missing list confirms nothing.
				if (expectedScreenIds !== undefined) {
					const delivered = new Set((status.screens ?? []).map((s) => s.id))
					const missing = expectedScreenIds.filter((id) => !delivered.has(id))
					if (missing.length > 0) {
						throw new YodeckApiError(
							`Bulk push completed but ${missing.length} of ${expectedScreenIds.length} screen(s) were not reported as successful: ${missing.map((id) => this.screenLabel(id)).join(', ')}`,
						)
					}
				}
				this.setVariableValues({ last_push_progress: '' })
				return
			}
			if (status.status === 'failed') {
				throw new YodeckApiError(`Bulk push failed: ${JSON.stringify(status.errors ?? {})}`)
			}
			if (status.status === 'in_progress' && status.progress) {
				this.setVariableValues({
					last_push_progress: `${status.progress.index} of ${status.progress.of} (${status.progress.percent}%)`,
				})
			}
		}

		if (!this.destroyed) {
			throw new YodeckApiError('Timed out waiting for the bulk push to complete')
		}
	}

	private reportPushSuccess(): void {
		this.lastPushOk = true
		this.setVariableValues({ last_push_status: 'ok', last_push_error_message: '' })
		this.checkFeedbacks('push_succeeded', 'push_failed')
	}

	private reportPushFailure(e: unknown): void {
		this.lastPushOk = false
		const message = errorMessage(e)
		this.log('warn', `Push failed: ${message}`)
		this.setVariableValues({ last_push_status: 'failed', last_push_error_message: message, last_push_progress: '' })
		this.checkFeedbacks('push_succeeded', 'push_failed')
		this.flagIfAuthFailure(e)
	}

	// ─── Takeover ────────────────────────────────────────────────────────

	async takeoverScreens(opts: TakeoverOptions): Promise<void> {
		return this.takeoverQueue.run(async () => this.takeoverScreensInner(opts))
	}

	private async takeoverScreensInner(opts: TakeoverOptions): Promise<void> {
		const { target, sourceType, sourceId, durationMinutes, useDownloadTimeslots } = opts
		// Stamped at attempt start with the previous targets cleared, same as beginPushAttempt.
		this.setVariableValues({
			last_takeover_time: new Date().toISOString(),
			last_takeover_targets: '',
			last_takeover_target_names: '',
		})

		try {
			const optionScreenIds = checkTargetInputs(opts)

			// Content is validated before target resolution, so a broken button doesn't spend a
			// GET /screens sweep on every press. Duration is ignored when clearing: its field is hidden
			// then, but may still hold a stale value.
			let content: YodeckTakeoverContent = null
			if (sourceType !== 'clear_takeover') {
				if (sourceId === undefined) throw new YodeckApiError('No content ID provided')
				// Blank means indefinite, so a value that didn't parse must fail rather than read as blank.
				if (durationMinutes === null) {
					throw new YodeckApiError('Duration must be a whole number of minutes (leave it blank to run until cleared)')
				}
				if (durationMinutes !== undefined && durationMinutes < 5) {
					throw new YodeckApiError('Duration must be at least 5 minutes')
				}
				content = { sourceId, sourceType, durationMinutes }
			}

			// The takeover endpoint has no workspace/all-screens form, so those are always resolved here.
			const screenIds =
				target === 'workspace'
					? await this.resolveScreens(opts.workspaceId)
					: target === 'all'
						? await this.resolveScreens()
						: optionScreenIds

			const { ids, names } = this.describeTargets(screenIds)
			this.setVariableValues({ last_takeover_targets: ids, last_takeover_target_names: names })

			if (target === 'single') {
				const screenId = screenIds[0]
				const result = await this.api.takeoverScreen(screenId, content, useDownloadTimeslots)
				if (result.status !== 'success') {
					throw new YodeckApiError(`Takeover failed for screen ${screenId}: ${JSON.stringify(result.errors ?? {})}`)
				}
			} else {
				const result = await this.api.takeoverScreensBulk(screenIds, content, useDownloadTimeslots)
				// Cross-checked by screen ID, as for a completed bulk push: a screen the response omits was
				// never taken over.
				const reported = new Map((result.screens ?? []).map((row) => [row.id, row]))
				const failures = screenIds.flatMap((id) => {
					const row = reported.get(id)
					if (row === undefined) return [`${this.screenLabel(id)}: not reported by Yodeck`]
					if (row.status !== 'success') return [`${this.screenLabel(id)}: ${JSON.stringify(row.errors ?? {})}`]
					return []
				})
				if (failures.length > 0) {
					throw new YodeckApiError(`Takeover failed for screen(s): ${failures.join('; ')}`)
				}
			}

			this.reportTakeoverSuccess()
		} catch (e: unknown) {
			this.reportTakeoverFailure(e)
		}
	}

	private reportTakeoverSuccess(): void {
		this.lastTakeoverOk = true
		this.setVariableValues({ last_takeover_status: 'ok', last_takeover_error_message: '' })
		this.checkFeedbacks('takeover_succeeded', 'takeover_failed')
	}

	private reportTakeoverFailure(e: unknown): void {
		this.lastTakeoverOk = false
		const message = errorMessage(e)
		this.log('warn', `Takeover failed: ${message}`)
		this.setVariableValues({ last_takeover_status: 'failed', last_takeover_error_message: message })
		this.checkFeedbacks('takeover_succeeded', 'takeover_failed')
		this.flagIfAuthFailure(e)
	}

	// ─── Emergency alerts ────────────────────────────────────────────────

	async broadcastEmergencyAlert(opts: {
		alertId: number | undefined
		target: 'all' | 'workspace' | 'group'
		workspaceId: number | undefined
		broadcastGroupId: number | undefined
		headline: string | undefined
		description: string | undefined
		instruction: string | undefined
		durationSeconds: number | undefined | null
	}): Promise<void> {
		this.setVariableValues({ last_alert_broadcast_time: new Date().toISOString() })

		try {
			if (opts.alertId === undefined) throw new YodeckApiError('No emergency alert selected')
			// Blank means the alert's own duration, so a value that didn't parse must fail rather than
			// silently fall back to Yodeck's 2-hour default.
			if (opts.durationSeconds === null) {
				throw new YodeckApiError(
					"Duration must be a whole number of seconds (leave it blank to use the alert's own duration)",
				)
			}
			if (opts.target === 'workspace') {
				if (opts.workspaceId === undefined) throw new YodeckApiError('No workspace ID provided')
				// Fail on an empty workspace rather than broadcast to nothing. (Broadcast screen groups
				// can't be checked this way: the API only exposes a group's tags, not its screens.)
				await this.resolveScreens(opts.workspaceId)
			}
			if (opts.target === 'group' && opts.broadcastGroupId === undefined) {
				throw new YodeckApiError('No broadcast screen group selected')
			}

			const result = await this.api.broadcastEmergencyAlert(opts.alertId, {
				headline: opts.headline,
				description: opts.description,
				instruction: opts.instruction,
				durationSeconds: opts.durationSeconds,
				workspace: opts.workspaceId,
				broadcastScreenGroup: opts.broadcastGroupId,
			})
			// Only written on success, so a failed attempt keeps the previous broadcast cancellable.
			this.lastBroadcastHash = result.broadcast_hash
			this.setVariableValues({ last_alert_broadcast_hash: result.broadcast_hash })
			this.reportAlertOpSuccess()
		} catch (e: unknown) {
			this.reportAlertOpFailure(e)
		}
	}

	async cancelAllEmergencyBroadcasts(): Promise<void> {
		this.setVariableValues({ last_alert_broadcast_time: new Date().toISOString() })

		try {
			await this.api.cancelAllBroadcasts()
			this.reportAlertOpSuccess()
		} catch (e: unknown) {
			this.reportAlertOpFailure(e)
		}
	}

	async cancelEmergencyBroadcast(opts: { broadcastHash: string }): Promise<void> {
		this.setVariableValues({ last_alert_broadcast_time: new Date().toISOString() })

		try {
			if (!opts.broadcastHash) throw new YodeckApiError('No broadcast hash provided')
			await this.api.cancelBroadcast(opts.broadcastHash)
			// A cancelled hash is dead, so clear it — but only if it's the one we're tracking, so
			// cancelling a hand-entered hash leaves ours intact.
			if (this.lastBroadcastHash !== '' && this.lastBroadcastHash === opts.broadcastHash) {
				this.lastBroadcastHash = ''
				this.setVariableValues({ last_alert_broadcast_hash: '' })
			}
			this.reportAlertOpSuccess()
		} catch (e: unknown) {
			this.reportAlertOpFailure(e)
		}
	}

	private reportAlertOpSuccess(): void {
		this.lastAlertBroadcastOk = true
		this.setVariableValues({ last_alert_broadcast_status: 'ok', last_alert_broadcast_error_message: '' })
		this.checkFeedbacks('alert_broadcast_succeeded', 'alert_broadcast_failed')
	}

	private reportAlertOpFailure(e: unknown): void {
		this.lastAlertBroadcastOk = false
		const message = errorMessage(e)
		this.log('warn', `Emergency alert operation failed: ${message}`)
		this.setVariableValues({ last_alert_broadcast_status: 'failed', last_alert_broadcast_error_message: message })
		this.checkFeedbacks('alert_broadcast_succeeded', 'alert_broadcast_failed')
		this.flagIfAuthFailure(e)
	}

	/** Only a clear auth failure marks the connection down — a single bad ID shouldn't. */
	private flagIfAuthFailure(e: unknown): void {
		if (e instanceof YodeckApiError && (e.status === 401 || e.status === 403)) {
			this.connectionOk = false
			this.updateStatus(...statusForError(e))
		}
	}
}

/** Validates the parts of a screen target that don't need an API call, returning the parsed screen
 *  IDs. Branches on `target` rather than on which fields are filled in: hidden fields keep their
 *  stored values, so a button switched from Single Screen to Workspace still carries its old ID. */
function checkTargetInputs(opts: TargetOptions<ScreenTarget>): number[] {
	const { target, screenIds, workspaceId } = opts
	if (target === 'workspace') {
		if (workspaceId === undefined) throw new YodeckApiError('No workspace ID provided')
		return []
	}
	if (target === 'all') return []

	// `null` means an entry wasn't a whole number (typically an unresolved variable). Dropping it
	// instead would silently target fewer screens than configured.
	if (screenIds === null) {
		throw new YodeckApiError('Screen ID(s) must be whole numbers, comma-separated — check the field or its variable')
	}
	if (screenIds.length === 0) throw new YodeckApiError('No valid screen ID(s) provided')
	if (target === 'single' && screenIds.length > 1) {
		throw new YodeckApiError(
			'Single Screen takes exactly one screen ID — use the multiple/specific screens target for a list',
		)
	}
	return screenIds
}

/** Runs async tasks strictly one after another. Tasks are expected to report their own failures;
 *  a rejection is passed back to the caller but never blocks the queue. */
class SerialQueue {
	private tail: Promise<void> = Promise.resolve()

	async run(task: () => Promise<void>): Promise<void> {
		const current = this.tail.then(task, task)
		this.tail = current.catch(() => undefined)
		return current
	}
}

/** Like `Promise.allSettled(items.map(fn))`, but with at most `limit` calls in flight at once. */
async function mapSettledLimited<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array<PromiseSettledResult<R>>(items.length)
	let next = 0
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const i = next++
			try {
				results[i] = { status: 'fulfilled', value: await fn(items[i]) }
			} catch (reason: unknown) {
				results[i] = { status: 'rejected', reason }
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
	return results
}

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

function statusForError(e: unknown): [InstanceStatus, string?] {
	if (e instanceof YodeckApiError) {
		if (e.status === 401) return [InstanceStatus.AuthenticationFailure, e.message]
		if (e.status === 403) return [InstanceStatus.InsufficientPermissions, e.message]
		if (e.status === 429) return [InstanceStatus.UnknownWarning, 'Rate limited while contacting Yodeck']
		if (e.status === undefined) return [InstanceStatus.ConnectionFailure, e.message]
		return [InstanceStatus.UnknownError, e.message]
	}
	return [InstanceStatus.UnknownError, errorMessage(e)]
}

/** Compares a cached id→ref map against a freshly-fetched list by id+name pairs, so a rename also
 *  counts as a change. */
function contentListChanged(cache: Map<number, YodeckRef>, fresh: YodeckRef[]): boolean {
	const key = (refs: YodeckRef[]) =>
		refs
			.map((v) => `${v.id}:${v.name}`)
			.sort()
			.join('|')
	return key(Array.from(cache.values())) !== key(fresh)
}
