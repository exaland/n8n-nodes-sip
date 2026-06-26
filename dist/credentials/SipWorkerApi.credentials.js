"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SipWorkerApi = void 0;
class SipWorkerApi {
    constructor() {
        this.name = 'sipWorkerApi';
        this.displayName = 'SIP Worker API';
        this.documentationUrl = 'https://github.com/onsip/SIP.js/releases';
        this.properties = [
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
}
exports.SipWorkerApi = SipWorkerApi;
