import type ModuleInstance from './main.js'

export type VariablesSchema = {
	last_push_status: string
	last_push_targets: string
	last_push_target_names: string
	last_push_time: string
	last_push_progress: string
	last_push_error_message: string
	screens_online_count: string
	screens_total_count: string
	found_media_status: string
	found_media_id: string
	found_media_name: string
	found_media_count: string
	found_media_time: string
	found_media_error_message: string
	last_schedule_exception_status: string
	last_schedule_exception_time: string
	last_schedule_exception_error_message: string
	last_schedule_exception_info: string
	last_takeover_status: string
	last_takeover_targets: string
	last_takeover_target_names: string
	last_takeover_time: string
	last_takeover_error_message: string
	last_alert_broadcast_status: string
	last_alert_broadcast_hash: string
	last_alert_broadcast_time: string
	last_alert_broadcast_error_message: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		last_push_status: { name: 'Status of the last push attempt (ok / failed / never)' },
		last_push_targets: { name: 'Screen ID(s) targeted by the last push attempt (or "all screens")' },
		last_push_target_names: { name: 'The same push targets, resolved to screen names where known' },
		last_push_time: { name: 'Timestamp of the last push attempt' },
		last_push_progress: { name: 'Progress of an in-flight multi-screen push' },
		last_push_error_message: { name: 'Error message from the last failed push' },
		screens_online_count: { name: 'Number of screens currently online' },
		screens_total_count: { name: 'Total number of screens on the account' },
		found_media_status: { name: 'Status of the last Find Media attempt (ok / failed / never)' },
		found_media_id: { name: 'ID of the first media match from the last Find Media action' },
		found_media_name: { name: 'Name of the first media match from the last Find Media action' },
		found_media_count: { name: 'Total number of media matches from the last Find Media action' },
		found_media_time: { name: 'Timestamp of the last Find Media attempt' },
		found_media_error_message: { name: 'Error message from the last failed Find Media attempt' },
		last_schedule_exception_status: {
			name: 'Status of the last Add Schedule Event Exception attempt (ok / failed / never)',
		},
		last_schedule_exception_time: { name: 'Timestamp of the last Add Schedule Event Exception attempt' },
		last_schedule_exception_error_message: { name: 'Error message from the last failed event exception attempt' },
		last_schedule_exception_info: { name: "Yodeck's info/note message from the last successful event exception" },
		last_takeover_status: { name: 'Status of the last Take Over Screen(s) attempt (ok / failed / never)' },
		last_takeover_targets: { name: 'Screen ID(s) targeted by the last takeover attempt' },
		last_takeover_target_names: { name: 'The same takeover targets, resolved to screen names where known' },
		last_takeover_time: { name: 'Timestamp of the last takeover attempt' },
		last_takeover_error_message: { name: 'Error message from the last failed takeover attempt' },
		last_alert_broadcast_status: {
			name: 'Status of the last broadcast/cancel emergency-alert attempt (ok / failed / never)',
		},
		last_alert_broadcast_hash: { name: 'The broadcast_hash returned by the last Broadcast Emergency Alert attempt' },
		last_alert_broadcast_time: { name: 'Timestamp of the last broadcast/cancel emergency-alert attempt' },
		last_alert_broadcast_error_message: {
			name: 'Error message from the last failed broadcast/cancel emergency-alert attempt',
		},
	})
}
