import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	tokenLabel: string
}

export type ModuleSecrets = {
	apiToken: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'API Token',
			width: 12,
			value:
				'Create a token in Yodeck under Account Settings → Advanced Settings → API Tokens, ' +
				'then enter its label and value below.',
		},
		{
			type: 'textinput',
			id: 'tokenLabel',
			label: 'API Token Label',
			width: 6,
			tooltip: 'The label shown next to the token in the Yodeck API Tokens list.',
		},
		{
			type: 'secret-text',
			id: 'apiToken',
			label: 'API Token Value',
			width: 6,
			tooltip: 'The secret token value from Yodeck.',
		},
	]
}
