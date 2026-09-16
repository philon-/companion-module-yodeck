import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'

const WHITE = 0xffffff
const BLACK = 0x000000

export function UpdatePresets(self: ModuleInstance): void {
	const structure: CompanionPresetSection[] = [
		{
			id: 'screens',
			name: 'Screens',
			definitions: [
				{
					id: 'utility',
					name: 'Utility',
					description: 'Force a refresh of every screen without changing their assigned content',
					type: 'simple',
					presets: ['refresh_all'],
				},
			],
		},
		{
			id: 'emergency',
			name: 'Emergency',
			definitions: [
				{
					id: 'panic',
					name: 'Panic Buttons',
					description: 'Immediately clear any overrides across every screen',
					type: 'simple',
					presets: ['clear_all_takeovers', 'cancel_all_broadcasts'],
				},
			],
		},
	]

	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	presets.refresh_all = {
		type: 'simple',
		name: 'Refresh all screens',
		style: {
			text: 'Refresh\nAll Screens',
			size: 'auto',
			color: WHITE,
			bgcolor: BLACK,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'push_screen',
						options: { target: 'all', screen_id: '', screen_ids: '', workspace_id: '', use_download_timeslots: false },
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{ feedbackId: 'push_succeeded', options: {}, style: { bgcolor: 0x006400, color: WHITE } },
			{ feedbackId: 'push_failed', options: {}, style: { bgcolor: 0x8b0000, color: WHITE } },
		],
	}
	presets.clear_all_takeovers = {
		type: 'simple',
		name: 'Clear all takeovers',
		style: {
			text: 'Clear\nAll Takeovers',
			size: 'auto',
			color: WHITE,
			bgcolor: BLACK,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'take_over_screens',
						options: {
							target: 'all',
							screen_id: '',
							screen_ids: '',
							workspace_id: '',
							source_type: 'clear_takeover',
							source_id_text: '',
							source_id_playlist: '',
							source_id_layout: '',
							duration_minutes: '',
							use_download_timeslots: false,
						},
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{ feedbackId: 'takeover_succeeded', options: {}, style: { bgcolor: 0x006400, color: WHITE } },
			{ feedbackId: 'takeover_failed', options: {}, style: { bgcolor: 0x8b0000, color: WHITE } },
		],
	}
	presets.cancel_all_broadcasts = {
		type: 'simple',
		name: 'Cancel all emergency broadcasts',
		style: {
			text: 'Cancel All\nBroadcasts',
			size: 'auto',
			color: WHITE,
			bgcolor: BLACK,
			show_topbar: false,
		},
		steps: [
			{
				down: [{ actionId: 'cancel_all_emergency_broadcasts', options: {} }],
				up: [],
			},
		],
		feedbacks: [
			{ feedbackId: 'alert_broadcast_succeeded', options: {}, style: { bgcolor: 0x006400, color: WHITE } },
			{ feedbackId: 'alert_broadcast_failed', options: {}, style: { bgcolor: 0x8b0000, color: WHITE } },
		],
	}

	self.setPresetDefinitions(structure, presets)
}
