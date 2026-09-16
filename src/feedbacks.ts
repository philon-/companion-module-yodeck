import type ModuleInstance from './main.js'

export type FeedbacksSchema = {
	push_succeeded: { type: 'boolean'; options: Record<string, never> }
	push_failed: { type: 'boolean'; options: Record<string, never> }
	screen_online: { type: 'boolean'; options: { screen_id: string } }
	find_media_succeeded: { type: 'boolean'; options: Record<string, never> }
	find_media_failed: { type: 'boolean'; options: Record<string, never> }
	schedule_exception_succeeded: { type: 'boolean'; options: Record<string, never> }
	schedule_exception_failed: { type: 'boolean'; options: Record<string, never> }
	takeover_succeeded: { type: 'boolean'; options: Record<string, never> }
	takeover_failed: { type: 'boolean'; options: Record<string, never> }
	alert_broadcast_succeeded: { type: 'boolean'; options: Record<string, never> }
	alert_broadcast_failed: { type: 'boolean'; options: Record<string, never> }
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		push_succeeded: {
			name: 'Last push succeeded',
			description: 'True from the moment the most recent push/refresh action succeeds, until the next attempt.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006400, color: 0xffffff },
			options: [],
			callback: () => self.lastPushOk === true,
		},
		push_failed: {
			name: 'Last push failed',
			description: 'True from the moment the most recent push/refresh action fails, until the next attempt.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x8b0000, color: 0xffffff },
			options: [],
			callback: () => self.lastPushOk === false,
		},
		screen_online: {
			name: 'Screen is online',
			description: 'True while the given screen last reported itself online. Refreshed about once a minute.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006400, color: 0xffffff },
			options: [
				{
					id: 'screen_id',
					type: 'textinput',
					label: 'Screen ID',
					useVariables: true,
				},
			],
			// Matched strictly rather than with parseInt, which reads a prefix: "7-holiday" would become
			// screen 7 and light the button for a screen this feedback was never pointed at.
			callback: (feedback) => {
				const id = feedback.options.screen_id.trim()
				return /^\d+$/.test(id) ? self.screens.get(Number(id))?.online === true : false
			},
		},
		find_media_succeeded: {
			name: 'Last Find Media succeeded',
			description: 'True from the moment the most recent Find Media action succeeds, until the next attempt.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006400, color: 0xffffff },
			options: [],
			callback: () => self.lastFindMediaOk === true,
		},
		find_media_failed: {
			name: 'Last Find Media failed',
			description: 'True from the moment the most recent Find Media action fails, until the next attempt.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x8b0000, color: 0xffffff },
			options: [],
			callback: () => self.lastFindMediaOk === false,
		},
		schedule_exception_succeeded: {
			name: 'Last schedule event exception succeeded',
			description:
				'True from the moment the most recent Add Schedule Event Exception action succeeds, until the next attempt.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006400, color: 0xffffff },
			options: [],
			callback: () => self.lastScheduleExceptionOk === true,
		},
		schedule_exception_failed: {
			name: 'Last schedule event exception failed',
			description:
				'True from the moment the most recent Add Schedule Event Exception action fails, until the next attempt.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x8b0000, color: 0xffffff },
			options: [],
			callback: () => self.lastScheduleExceptionOk === false,
		},
		takeover_succeeded: {
			name: 'Last takeover succeeded',
			description: 'True from the moment the most recent Take Over Screen(s) action succeeds, until the next attempt.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006400, color: 0xffffff },
			options: [],
			callback: () => self.lastTakeoverOk === true,
		},
		takeover_failed: {
			name: 'Last takeover failed',
			description: 'True from the moment the most recent Take Over Screen(s) action fails, until the next attempt.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x8b0000, color: 0xffffff },
			options: [],
			callback: () => self.lastTakeoverOk === false,
		},
		alert_broadcast_succeeded: {
			name: 'Last emergency alert operation succeeded',
			description:
				'True from the moment the most recent Broadcast/Cancel Emergency Alert action succeeds, until the next attempt.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006400, color: 0xffffff },
			options: [],
			callback: () => self.lastAlertBroadcastOk === true,
		},
		alert_broadcast_failed: {
			name: 'Last emergency alert operation failed',
			description:
				'True from the moment the most recent Broadcast/Cancel Emergency Alert action fails, until the next attempt.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x8b0000, color: 0xffffff },
			options: [],
			callback: () => self.lastAlertBroadcastOk === false,
		},
	})
}
