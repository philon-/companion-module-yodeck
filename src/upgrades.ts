import type {
	CompanionMigrationAction,
	CompanionStaticUpgradeProps,
	CompanionStaticUpgradeResult,
	CompanionStaticUpgradeScript,
	CompanionUpgradeContext,
} from '@companion-module/base'
import type { ModuleConfig } from './config.js'

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [
	/*
	 * Place your upgrade scripts here
	 * Remember that once it has been added it cannot be removed!
	 */

	// Phase 4: push_content's single `source_id` field was split into `source_id_text` (media/schedule),
	// `source_id_playlist`, and `source_id_layout` (dropdown pickers backed by cached lists). Route each
	// existing button's stored value into the field its `source_type` now maps to, so no configured
	// content ID is silently lost.
	(
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, undefined>,
	): CompanionStaticUpgradeResult<ModuleConfig, undefined> => {
		const updatedActions: CompanionMigrationAction[] = []

		for (const action of props.actions) {
			if (action.actionId !== 'push_content') continue
			const options = action.options
			if (!('source_id' in options)) continue // already migrated, or never had it

			const oldSourceId = options.source_id
			const sourceTypeOpt = options.source_type
			const sourceTypeLiteral = sourceTypeOpt && !sourceTypeOpt.isExpression ? sourceTypeOpt.value : undefined

			const newOptions = { ...options }
			delete newOptions.source_id

			if (sourceTypeLiteral === 'playlist') {
				newOptions.source_id_playlist = oldSourceId
			} else if (sourceTypeLiteral === 'layout') {
				newOptions.source_id_layout = oldSourceId
			} else if (sourceTypeLiteral === undefined) {
				// source_type is itself an expression — can't know which field will be visible at
				// runtime, so preserve the old value under all three rather than guess wrong.
				newOptions.source_id_text = oldSourceId
				newOptions.source_id_playlist = oldSourceId
				newOptions.source_id_layout = oldSourceId
			} else {
				newOptions.source_id_text = oldSourceId
			}

			updatedActions.push({ ...action, options: newOptions })
		}

		return {
			updatedConfig: null,
			updatedActions,
			updatedFeedbacks: [],
		}
	},

	// Phase 5: push_content gained a `source_id_schedule` dropdown for source_type 'schedule', narrowing
	// `source_id_text`'s visibility to media only (source_id_text itself is untouched — only its
	// visibility changed). Backfill source_id_schedule for buttons that were relying on source_id_text
	// for a schedule, so their configured Content ID isn't silently dropped.
	(
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, undefined>,
	): CompanionStaticUpgradeResult<ModuleConfig, undefined> => {
		const updatedActions: CompanionMigrationAction[] = []

		for (const action of props.actions) {
			if (action.actionId !== 'push_content') continue
			const options = action.options
			if ('source_id_schedule' in options) continue // already migrated

			const sourceTypeOpt = options.source_type
			const sourceTypeLiteral = sourceTypeOpt && !sourceTypeOpt.isExpression ? sourceTypeOpt.value : undefined
			// Only schedule-typed (or ambiguous-expression) buttons need a value backfilled here —
			// media/playlist/layout/turned_off buttons are unaffected by this option's visibility change.
			if (sourceTypeLiteral !== 'schedule' && sourceTypeLiteral !== undefined) continue

			updatedActions.push({ ...action, options: { ...options, source_id_schedule: options.source_id_text } })
		}

		return {
			updatedConfig: null,
			updatedActions,
			updatedFeedbacks: [],
		}
	},
]
