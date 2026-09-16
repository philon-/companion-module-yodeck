import type {
	CompanionInputFieldCheckbox,
	CompanionInputFieldDropdown,
	CompanionInputFieldTextInput,
} from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { PushContentOptions, RefreshScreensOptions, TakeoverOptions } from './main.js'
import type { YodeckExceptionType, YodeckRef } from './yodeck-api.js'

export type ActionsSchema = {
	push_content: {
		options: {
			target: string
			screen_id: string
			screen_ids: string
			workspace_id: string
			source_type: string
			source_id_text: string
			source_id_playlist: string
			source_id_layout: string
			source_id_schedule: string
			use_download_timeslots: boolean
		}
	}
	push_screen: {
		options: {
			target: string
			screen_id: string
			screen_ids: string
			workspace_id: string
			use_download_timeslots: boolean
		}
	}
	find_media: {
		options: {
			query: string
			tags: string
			workspace_id: string
		}
	}
	add_schedule_event_exception: {
		options: {
			schedule_id: string
			event_id: string
			exception_type: string
			date: string
		}
	}
	take_over_screens: {
		options: {
			target: string
			screen_id: string
			screen_ids: string
			workspace_id: string
			source_type: string
			source_id_text: string
			source_id_playlist: string
			source_id_layout: string
			duration_minutes: string
			use_download_timeslots: boolean
		}
	}
	broadcast_emergency_alert: {
		options: {
			alert_id: string
			target: string
			workspace_id: string
			broadcast_group_id: string
			headline: string
			description: string
			instruction: string
			duration_seconds: string
		}
	}
	cancel_all_emergency_broadcasts: {
		options: Record<string, never>
	}
	cancel_emergency_broadcast: {
		options: {
			broadcast_hash: string
		}
	}
}

/** Parses a single id ("12") or a comma-separated list ("12, 34, 56") into deduplicated screen ids.
 *  Returns `null` if any non-blank entry isn't a whole number, rather than silently dropping it
 *  (e.g. an unresolved variable) and targeting fewer screens than configured. */
function parseScreenIds(raw: string): number[] | null {
	const ids: number[] = []
	for (const part of raw.split(',')) {
		const trimmed = part.trim()
		if (trimmed.length === 0) continue
		if (!/^\d+$/.test(trimmed)) return null
		ids.push(Number(trimmed))
	}
	return Array.from(new Set(ids))
}

/** Parses a comma-separated tag list, dropping empty entries. */
function parseTags(raw: string): string[] {
	return raw
		.split(',')
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0)
}

/** Parses an optional whole number: `undefined` if blank, `null` if it held anything else (typically
 *  an unresolved variable). Use this where blank selects a different behavior (indefinite takeover,
 *  default broadcast duration, search every workspace), so junk can't silently select it too. */
function parseStrictOptionalInt(raw: string): number | undefined | null {
	const trimmed = raw.trim()
	if (trimmed.length === 0) return undefined
	return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

/** Like `parseStrictOptionalInt`, but treats junk as "not provided". Only for fields whose "not
 *  provided" case is rejected outright. (Not `parseInt`, which reads "7-holiday" as 7.) */
function parseOptionalInt(raw: string): number | undefined {
	return parseStrictOptionalInt(raw) ?? undefined
}

/** A searchable dropdown over one of the cached `{id, name}` lists. `allowCustom` so a raw ID or
 *  variable expression still works, including before the cache has populated. */
function contentPickerOption<K extends string>(
	cache: Map<number, YodeckRef>,
	opts: { id: K; label: string; isVisibleExpression?: string },
): CompanionInputFieldDropdown<K> {
	return {
		id: opts.id,
		type: 'dropdown',
		label: opts.label,
		default: '',
		allowCustom: true,
		minChoicesForSearch: 10,
		isVisibleExpression: opts.isVisibleExpression,
		choices: Array.from(cache.values()).map((v) => ({ id: String(v.id), label: v.name })),
	}
}

/** The Target dropdown plus its Screen ID / Screen IDs / Workspace ID fields, shared by every
 *  screen-targeting action. `multi` is the id of the comma-separated-list target. */
function screenTargetOptions(
	multi: { id: 'multiple' | 'specific'; label: string },
	includeAll: boolean,
): [
	CompanionInputFieldDropdown<'target'>,
	CompanionInputFieldTextInput<'screen_id'>,
	CompanionInputFieldTextInput<'screen_ids'>,
	CompanionInputFieldTextInput<'workspace_id'>,
] {
	return [
		{
			id: 'target',
			type: 'dropdown',
			label: 'Target',
			default: 'single',
			disableAutoExpression: true,
			choices: [
				{ id: 'single', label: 'Single Screen' },
				multi,
				{ id: 'workspace', label: 'Screens in Workspace' },
				...(includeAll ? [{ id: 'all', label: 'All Screens' }] : []),
			],
		},
		{
			id: 'screen_id',
			type: 'textinput',
			label: 'Screen ID',
			useVariables: true,
			isVisibleExpression: "$(options:target) == 'single'",
		},
		{
			id: 'screen_ids',
			type: 'textinput',
			label: 'Screen IDs (comma-separated)',
			useVariables: true,
			isVisibleExpression: `$(options:target) == '${multi.id}'`,
		},
		{
			id: 'workspace_id',
			type: 'textinput',
			label: 'Workspace ID',
			useVariables: true,
			isVisibleExpression: "$(options:target) == 'workspace'",
		},
	]
}

function downloadTimeslotsOption(what: string): CompanionInputFieldCheckbox<'use_download_timeslots'> {
	return {
		id: 'use_download_timeslots',
		type: 'checkbox',
		label: 'Respect download timeslots',
		default: false,
		tooltip: `When enabled, screens only download the ${what} during their configured timeslot instead of immediately.`,
	}
}

/** Parses the target fields written by `screenTargetOptions`, reading only the one the target uses. */
function parseTargetOptions<T extends string>(options: {
	target: string
	screen_id: string
	screen_ids: string
	workspace_id: string
}): { target: T; screenIds: number[] | null; workspaceId: number | undefined } {
	const target = options.target
	return {
		target: target as T,
		screenIds:
			target === 'single'
				? parseScreenIds(options.screen_id)
				: target === 'multiple' || target === 'specific'
					? parseScreenIds(options.screen_ids)
					: [],
		workspaceId: target === 'workspace' ? parseOptionalInt(options.workspace_id) : undefined,
	}
}

/** Reads the Content ID from whichever field the Content Type shows: a picker for playlist/layout/
 *  schedule, free text for media. */
function parseContentId(
	sourceType: string,
	options: {
		source_id_text: string
		source_id_playlist: string
		source_id_layout: string
		source_id_schedule?: string
	},
): number | undefined {
	switch (sourceType) {
		case 'media':
			return parseOptionalInt(options.source_id_text)
		case 'playlist':
			return parseOptionalInt(options.source_id_playlist)
		case 'layout':
			return parseOptionalInt(options.source_id_layout)
		case 'schedule':
			return parseOptionalInt(options.source_id_schedule ?? '')
		default:
			return undefined
	}
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		push_content: {
			name: 'Push New Content to Screen(s)',
			description: 'Assign new content to one or more screens and immediately push it to them.',
			options: [
				...screenTargetOptions({ id: 'multiple', label: 'Multiple Screens' }, false),
				{
					id: 'source_type',
					type: 'dropdown',
					label: 'Content Type',
					default: 'media',
					disableAutoExpression: true,
					choices: [
						{ id: 'media', label: 'Media' },
						{ id: 'playlist', label: 'Playlist' },
						{ id: 'layout', label: 'Layout' },
						{ id: 'schedule', label: 'Schedule' },
						{ id: 'turned_off', label: 'Turn Screen Off' },
					],
				},
				{
					id: 'source_id_text',
					type: 'textinput',
					label: 'Content ID',
					useVariables: true,
					isVisibleExpression: "$(options:source_type) == 'media'",
				},
				contentPickerOption(self.playlists, {
					id: 'source_id_playlist',
					label: 'Playlist',
					isVisibleExpression: "$(options:source_type) == 'playlist'",
				}),
				contentPickerOption(self.layouts, {
					id: 'source_id_layout',
					label: 'Layout',
					isVisibleExpression: "$(options:source_type) == 'layout'",
				}),
				contentPickerOption(self.schedules, {
					id: 'source_id_schedule',
					label: 'Schedule',
					isVisibleExpression: "$(options:source_type) == 'schedule'",
				}),
				downloadTimeslotsOption('new content'),
			],
			callback: async (event) => {
				await self.pushContentToScreens({
					...parseTargetOptions<PushContentOptions['target']>(event.options),
					sourceType: event.options.source_type as PushContentOptions['sourceType'],
					sourceId: parseContentId(event.options.source_type, event.options),
					useDownloadTimeslots: event.options.use_download_timeslots,
				})
			},
		},

		push_screen: {
			name: 'Refresh Screen(s)',
			description:
				'Re-deliver whatever content is already assigned to one, several, or all screens, without changing it.',
			options: [
				...screenTargetOptions({ id: 'specific', label: 'Specific Screens' }, true),
				downloadTimeslotsOption('refreshed content'),
			],
			callback: async (event) => {
				await self.refreshScreens({
					...parseTargetOptions<RefreshScreensOptions['target']>(event.options),
					useDownloadTimeslots: event.options.use_download_timeslots,
				})
			},
		},

		find_media: {
			name: 'Find Media',
			description:
				'Look up existing media by name and/or tags, and store the first match (and total match count) in variables — useful for finding a Content ID to feed into Push New Content.',
			options: [
				{
					id: 'query',
					type: 'textinput',
					label: 'Name Contains',
					useVariables: true,
				},
				{
					id: 'tags',
					type: 'textinput',
					label: 'Tags (comma-separated, optional)',
					useVariables: true,
				},
				{
					id: 'workspace_id',
					type: 'textinput',
					label: 'Workspace ID (optional)',
					useVariables: true,
				},
			],
			callback: async (event) => {
				await self.findMedia({
					query: event.options.query,
					tags: parseTags(event.options.tags),
					workspaceId: parseStrictOptionalInt(event.options.workspace_id),
				})
			},
		},

		add_schedule_event_exception: {
			name: 'Add Schedule Event Exception',
			description:
				'Skip a specific occurrence (or all occurrences from a date forward) of an existing event within a schedule. Find the Event ID in Yodeck’s UI — this module does not list individual events.',
			options: [
				contentPickerOption(self.schedules, { id: 'schedule_id', label: 'Schedule' }),
				{
					id: 'event_id',
					type: 'textinput',
					label: 'Event ID',
					useVariables: true,
					tooltip: "The event's numeric ID, visible in Yodeck's UI when editing the schedule.",
				},
				{
					id: 'exception_type',
					type: 'dropdown',
					label: 'Exception Type',
					default: 'skip_on',
					disableAutoExpression: true,
					choices: [
						{ id: 'skip_on', label: 'Skip This Date' },
						{ id: 'skip_from', label: 'Skip From This Date Onward' },
					],
				},
				{
					id: 'date',
					type: 'textinput',
					label: 'Date (YYYY-MM-DD)',
					useVariables: true,
					regex: '/^\\d{4}-\\d{2}-\\d{2}$/',
					tooltip: 'The date the exception applies to, in YYYY-MM-DD format.',
				},
			],
			callback: async (event) => {
				await self.addScheduleEventException({
					scheduleId: parseOptionalInt(event.options.schedule_id),
					eventId: parseOptionalInt(event.options.event_id),
					exceptionType: event.options.exception_type as YodeckExceptionType,
					date: event.options.date,
				})
			},
		},

		take_over_screens: {
			name: 'Take Over Screen(s)',
			description:
				'Temporarily override one, several, or all screens with different content, optionally for a limited duration, without changing what they normally show. Choose "Clear Takeover" to immediately end an active takeover early.',
			options: [
				...screenTargetOptions({ id: 'specific', label: 'Specific Screens' }, true),
				{
					id: 'source_type',
					type: 'dropdown',
					label: 'Content Type',
					default: 'media',
					disableAutoExpression: true,
					choices: [
						{ id: 'media', label: 'Media' },
						{ id: 'playlist', label: 'Playlist' },
						{ id: 'layout', label: 'Layout' },
						{ id: 'clear_takeover', label: 'Clear Takeover' },
					],
				},
				{
					id: 'source_id_text',
					type: 'textinput',
					label: 'Content ID',
					useVariables: true,
					isVisibleExpression: "$(options:source_type) == 'media'",
				},
				contentPickerOption(self.playlists, {
					id: 'source_id_playlist',
					label: 'Playlist',
					isVisibleExpression: "$(options:source_type) == 'playlist'",
				}),
				contentPickerOption(self.layouts, {
					id: 'source_id_layout',
					label: 'Layout',
					isVisibleExpression: "$(options:source_type) == 'layout'",
				}),
				{
					id: 'duration_minutes',
					type: 'textinput',
					label: 'Duration in Minutes (optional)',
					useVariables: true,
					isVisibleExpression: "$(options:source_type) != 'clear_takeover'",
					tooltip: 'Minimum 5 minutes. Leave blank to run indefinitely, until cleared.',
				},
				downloadTimeslotsOption('takeover content'),
			],
			callback: async (event) => {
				await self.takeoverScreens({
					...parseTargetOptions<TakeoverOptions['target']>(event.options),
					sourceType: event.options.source_type as TakeoverOptions['sourceType'],
					sourceId: parseContentId(event.options.source_type, event.options),
					durationMinutes: parseStrictOptionalInt(event.options.duration_minutes),
					useDownloadTimeslots: event.options.use_download_timeslots,
				})
			},
		},

		broadcast_emergency_alert: {
			name: 'Broadcast Emergency Alert',
			description:
				'Broadcast an existing emergency alert to screens immediately. Leave the override fields blank to use the alert’s own configured headline/description/instruction/duration.',
			options: [
				contentPickerOption(self.emergencyAlerts, { id: 'alert_id', label: 'Emergency Alert' }),
				{
					id: 'target',
					type: 'dropdown',
					label: 'Target',
					default: 'all',
					disableAutoExpression: true,
					choices: [
						{ id: 'all', label: 'All Permitted Screens' },
						{ id: 'workspace', label: 'Workspace' },
						{ id: 'group', label: 'Broadcast Screen Group' },
					],
				},
				{
					id: 'workspace_id',
					type: 'textinput',
					label: 'Workspace ID',
					useVariables: true,
					isVisibleExpression: "$(options:target) == 'workspace'",
				},
				contentPickerOption(self.broadcastScreenGroups, {
					id: 'broadcast_group_id',
					label: 'Broadcast Screen Group',
					isVisibleExpression: "$(options:target) == 'group'",
				}),
				{
					id: 'headline',
					type: 'textinput',
					label: 'Headline Override (optional)',
					useVariables: true,
				},
				{
					id: 'description',
					type: 'textinput',
					label: 'Description Override (optional)',
					useVariables: true,
				},
				{
					id: 'instruction',
					type: 'textinput',
					label: 'Instruction Override (optional)',
					useVariables: true,
				},
				{
					id: 'duration_seconds',
					type: 'textinput',
					label: 'Duration in Seconds (optional)',
					useVariables: true,
					tooltip: 'Defaults to 7200 (2 hours) if left blank.',
				},
			],
			callback: async (event) => {
				const target = event.options.target as 'all' | 'workspace' | 'group'
				await self.broadcastEmergencyAlert({
					alertId: parseOptionalInt(event.options.alert_id),
					target,
					workspaceId: target === 'workspace' ? parseOptionalInt(event.options.workspace_id) : undefined,
					broadcastGroupId: target === 'group' ? parseOptionalInt(event.options.broadcast_group_id) : undefined,
					headline: event.options.headline || undefined,
					description: event.options.description || undefined,
					instruction: event.options.instruction || undefined,
					durationSeconds: parseStrictOptionalInt(event.options.duration_seconds),
				})
			},
		},

		cancel_all_emergency_broadcasts: {
			name: 'Cancel All Emergency Broadcasts',
			description: 'Immediately cancel every active emergency alert broadcast, across all screens.',
			options: [],
			callback: async () => {
				await self.cancelAllEmergencyBroadcasts()
			},
		},

		cancel_emergency_broadcast: {
			name: 'Cancel Broadcast',
			description:
				'Cancel one specific active emergency alert broadcast by its hash. The hash of the most recent broadcast is stored in the last_alert_broadcast_hash variable.',
			options: [
				{
					id: 'broadcast_hash',
					type: 'textinput',
					label: 'Broadcast Hash',
					useVariables: true,
					tooltip: 'Typically $(yodeck:last_alert_broadcast_hash), or a hash found via Yodeck’s UI.',
				},
			],
			callback: async (event) => {
				await self.cancelEmergencyBroadcast({ broadcastHash: event.options.broadcast_hash })
			},
		},
	})
}
