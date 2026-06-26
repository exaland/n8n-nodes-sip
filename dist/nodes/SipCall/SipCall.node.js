"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SipCall = void 0;
const n8n_workflow_1 = require("n8n-workflow");
class SipCall {
    constructor() {
        this.description = {
            displayName: 'SIP Call',
            name: 'sipCall',
            icon: 'file:sip.svg',
            group: ['transform'],
            version: 1,
            description: 'Make and control SIP calls through a SIP worker service',
            defaults: {
                name: 'SIP Call',
            },
            inputs: ['main'],
            outputs: ['main'],
            credentials: [
                {
                    name: 'sipWorkerApi',
                    required: true,
                },
            ],
            properties: [
                {
                    displayName: 'Operation',
                    name: 'operation',
                    type: 'options',
                    noDataExpression: true,
                    options: [
                        { name: 'Make Call', value: 'makeCall', action: 'Make a SIP call' },
                        { name: 'Hang Up', value: 'hangup', action: 'Hang up a SIP call' },
                        { name: 'Send DTMF', value: 'dtmf', action: 'Send DTMF tones' },
                        { name: 'Get Status', value: 'status', action: 'Get SIP call status' },
                    ],
                    default: 'makeCall',
                },
                {
                    displayName: 'To',
                    name: 'to',
                    type: 'string',
                    default: '',
                    required: true,
                    displayOptions: { show: { operation: ['makeCall'] } },
                    placeholder: 'sip:+33123456789@sip.provider.com',
                },
                {
                    displayName: 'From',
                    name: 'from',
                    type: 'string',
                    default: '',
                    displayOptions: { show: { operation: ['makeCall'] } },
                    placeholder: 'sip:1001@example.com',
                },
                {
                    displayName: 'Audio URL',
                    name: 'audioUrl',
                    type: 'string',
                    default: '',
                    displayOptions: { show: { operation: ['makeCall'] } },
                    description: 'Optional URL to an audio file for the worker to play after answer',
                },
                {
                    displayName: 'Wait For Completion',
                    name: 'waitForCompletion',
                    type: 'boolean',
                    default: false,
                    displayOptions: { show: { operation: ['makeCall'] } },
                },
                {
                    displayName: 'Timeout Seconds',
                    name: 'timeoutSeconds',
                    type: 'number',
                    default: 60,
                    typeOptions: { minValue: 1 },
                    displayOptions: { show: { operation: ['makeCall'] } },
                },
                {
                    displayName: 'Call ID',
                    name: 'callId',
                    type: 'string',
                    default: '',
                    required: true,
                    displayOptions: { show: { operation: ['hangup', 'dtmf', 'status'] } },
                },
                {
                    displayName: 'Digits',
                    name: 'digits',
                    type: 'string',
                    default: '',
                    required: true,
                    displayOptions: { show: { operation: ['dtmf'] } },
                    placeholder: '123#',
                },
                {
                    displayName: 'Additional Fields',
                    name: 'additionalFields',
                    type: 'collection',
                    placeholder: 'Add Field',
                    default: {},
                    options: [
                        {
                            displayName: 'Metadata',
                            name: 'metadata',
                            type: 'json',
                            default: '{}',
                            description: 'JSON metadata forwarded to the worker',
                        },
                    ],
                },
            ],
        };
    }
    async execute() {
        const items = this.getInputData();
        const credentials = await this.getCredentials('sipWorkerApi');
        const returnData = [];
        for (let i = 0; i < items.length; i++) {
            try {
                const operation = this.getNodeParameter('operation', i);
                const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');
                let method = 'POST';
                let endpoint = '/calls';
                const body = {};
                if (operation === 'makeCall') {
                    body.to = this.getNodeParameter('to', i);
                    body.from = this.getNodeParameter('from', i, '');
                    body.audioUrl = this.getNodeParameter('audioUrl', i, '');
                    body.waitForCompletion = this.getNodeParameter('waitForCompletion', i);
                    body.timeoutSeconds = this.getNodeParameter('timeoutSeconds', i);
                }
                else if (operation === 'hangup') {
                    endpoint = `/calls/${encodeURIComponent(this.getNodeParameter('callId', i))}/hangup`;
                }
                else if (operation === 'dtmf') {
                    endpoint = `/calls/${encodeURIComponent(this.getNodeParameter('callId', i))}/dtmf`;
                    body.digits = this.getNodeParameter('digits', i);
                }
                else if (operation === 'status') {
                    method = 'GET';
                    endpoint = `/calls/${encodeURIComponent(this.getNodeParameter('callId', i))}`;
                }
                const additionalFields = this.getNodeParameter('additionalFields', i, {});
                if (additionalFields.metadata) {
                    body.metadata = typeof additionalFields.metadata === 'string'
                        ? JSON.parse(additionalFields.metadata)
                        : additionalFields.metadata;
                }
                const options = {
                    method,
                    url: `${baseUrl}${endpoint}`,
                    json: true,
                    headers: {
                        Authorization: `Bearer ${credentials.apiKey}`,
                    },
                };
                if (method !== 'GET')
                    options.body = body;
                const response = await this.helpers.httpRequest(options);
                returnData.push({ json: response, pairedItem: { item: i } });
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({ json: { error: error.message }, pairedItem: { item: i } });
                    continue;
                }
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, { itemIndex: i });
            }
        }
        return [returnData];
    }
}
exports.SipCall = SipCall;
