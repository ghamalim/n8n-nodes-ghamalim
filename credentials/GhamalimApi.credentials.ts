import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class GhamalimApi implements ICredentialType {
	name = 'ghamalimApi';

	displayName = 'Ghamalim API';

	icon: Icon = {
		light: 'file:../nodes/Ghamalim/ghamalim.svg',
		dark: 'file:../nodes/Ghamalim/ghamalim.dark.svg',
	};

	documentationUrl = 'https://docs.ghamalim.net';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Created in the Ghamalim app under Settings > API Keys (admin or supervisor). Shown only once when created.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://app.ghamalim.net',
			description: 'Only change this if you were given a different address for your workspace',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}/api/v1',
			url: '/channels',
			method: 'GET',
		},
	};
}
