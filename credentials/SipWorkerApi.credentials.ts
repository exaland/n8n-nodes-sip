import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SipWorkerApi implements ICredentialType {
	name = 'sipWorkerApi';
	displayName = 'SIP Worker API';
	documentationUrl = 'https://github.com/onsip/SIP.js/releases';
	properties: INodeProperties[] = [
		{
			displayName: 'Worker Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://localhost:3008',
			required: true,
			placeholder: 'https://sip-worker.example.com',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
	];
}
