import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import crypto, { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';

const app = express();
app.use(express.json({ limit: '1mb' }));

const API_KEY = process.env.SIP_WORKER_API_KEY || 'change-me';
const PORT = Number(process.env.PORT || 3008);
const SIP_HOST = requiredEnv('SIP_HOST');
const SIP_PORT = Number(process.env.SIP_PORT || 5060);
const SIP_DOMAIN = process.env.SIP_DOMAIN || SIP_HOST;
const SIP_AUTH_USER = requiredEnv('SIP_AUTH_USER');
const SIP_PASSWORD = requiredEnv('SIP_PASSWORD');
const SIP_FROM_USER = process.env.SIP_FROM_USER || SIP_AUTH_USER;
const SIP_CONTACT_HOST = process.env.SIP_CONTACT_HOST || getLocalAddress();
const SIP_LOCAL_PORT = Number(process.env.SIP_LOCAL_PORT || 5062);
const RTP_IP = process.env.RTP_IP || SIP_CONTACT_HOST;
const RTP_PORT = Number(process.env.RTP_PORT || 40000);
const DEFAULT_MAX_SECONDS = Number(process.env.DEFAULT_MAX_SECONDS || 0);

const socket = dgram.createSocket('udp4');
let started = false;

type CallStatus = 'queued' | 'inviting' | 'authenticating' | 'ringing' | 'answered' | 'completed' | 'failed' | 'hangup_requested';
type CallRecord = {
  callId: string;
  sipCallId: string;
  to: string;
  toUser: string;
  status: CallStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  lastCode?: number;
  lastReason?: string;
  localTag: string;
  remoteTag?: string;
  cseq: number;
  branch: string;
  auth?: string;
  inviteText?: string;
};

const calls = new Map<string, CallRecord>();
const bySipCallId = new Map<string, string>();

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if ((req.header('authorization') || '') !== `Bearer ${API_KEY}`) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, sipStarted: started }));

app.post('/calls', (req, res) => {
  const { to, maxSeconds } = req.body || {};
  if (!to || typeof to !== 'string') return res.status(400).json({ error: 'Missing required field: to' });
  ensureStarted();

  const uri = normalizeSipUri(to);
  const call: CallRecord = {
    callId: randomUUID(),
    sipCallId: `${randomHex(16)}@${SIP_CONTACT_HOST}`,
    to: uri,
    toUser: sipUser(uri),
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    localTag: randomHex(6),
    cseq: Math.floor(Math.random() * 900000) + 1000,
    branch: newBranch(),
  };
  calls.set(call.callId, call);
  bySipCallId.set(call.sipCallId, call.callId);
  res.status(202).json(call);

  sendInvite(call.callId);
  const timeout = Number(maxSeconds || DEFAULT_MAX_SECONDS);
  if (timeout > 0) setTimeout(() => hangup(call.callId), timeout * 1000);
});

app.get('/calls/:callId', (req, res) => {
  const call = calls.get(req.params.callId);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  res.json(call);
});

app.post('/calls/:callId/hangup', (req, res) => {
  hangup(req.params.callId);
  res.json(calls.get(req.params.callId) || { ok: false });
});

function ensureStarted() {
  if (started) return;
  socket.on('message', (buf, rinfo) => onSipMessage(buf.toString('utf8'), rinfo.address, rinfo.port));
  socket.bind(SIP_LOCAL_PORT, '0.0.0.0', () => {
    console.log(`Raw SIP UDP listening on 0.0.0.0:${SIP_LOCAL_PORT}; public contact ${SIP_CONTACT_HOST}:${SIP_LOCAL_PORT}; PBX ${SIP_HOST}:${SIP_PORT}`);
  });
  started = true;
}

function sendInvite(callId: string) {
  const call = calls.get(callId);
  if (!call) return;
  setStatus(callId, call.auth ? 'authenticating' : 'inviting');
  const msg = buildInvite(call);
  call.inviteText = msg;
  calls.set(callId, call);
  sendRaw(msg);
}

function onSipMessage(msg: string, host: string, port: number) {
  console.log(`\n<--- SIP from ${host}:${port} ---\n${msg}\n---`);
  const callId = getHeader(msg, 'Call-ID');
  if (!callId) return;
  const id = bySipCallId.get(callId);
  if (!id) return;
  const call = calls.get(id);
  if (!call) return;

  const status = parseStatus(msg);
  if (!status) {
    if (msg.startsWith('BYE ')) {
      sendRaw(buildResponse(msg, 200, 'OK'));
      setStatus(id, 'completed');
    }
    return;
  }

  updateCall(id, { lastCode: status.code, lastReason: status.reason });

  if (status.code === 100) return;
  if (status.code === 180 || status.code === 183) return setStatus(id, 'ringing');

  if ((status.code === 401 || status.code === 407) && !call.auth) {
    sendAck(call, msg);
    const www = getHeader(msg, status.code === 407 ? 'Proxy-Authenticate' : 'WWW-Authenticate');
    if (!www) return setStatus(id, 'failed', `${status.code} sans challenge Digest`);
    call.auth = buildAuthorization(www, 'INVITE', call.to, status.code === 407 ? 'Proxy-Authorization' : 'Authorization');
    call.cseq += 1;
    call.branch = newBranch();
    calls.set(id, call);
    return sendInvite(id);
  }

  if (status.code >= 200 && status.code < 300) {
    call.remoteTag = extractTag(getHeader(msg, 'To') || '');
    calls.set(id, call);
    sendAck(call, msg);
    return setStatus(id, 'answered');
  }

  if (status.code >= 300) {
    sendAck(call, msg);
    return setStatus(id, 'failed', `${status.code} ${status.reason}`.trim());
  }
}

function buildInvite(call: CallRecord) {
  const sdp = buildSdp();
  const lines = [
    `INVITE ${call.to} SIP/2.0`,
    `Via: SIP/2.0/UDP ${SIP_CONTACT_HOST}:${SIP_LOCAL_PORT};branch=${call.branch};rport`,
    `Max-Forwards: 70`,
    `From: <sip:${SIP_FROM_USER}@${SIP_DOMAIN}>;tag=${call.localTag}`,
    `To: <${call.to}>`,
    `Call-ID: ${call.sipCallId}`,
    `CSeq: ${call.cseq} INVITE`,
    `Contact: <sip:${SIP_FROM_USER}@${SIP_CONTACT_HOST}:${SIP_LOCAL_PORT}>`,
    `Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO`,
    `User-Agent: n8n-raw-sip-worker`,
  ];
  if (call.auth) lines.push(call.auth);
  lines.push(`Content-Type: application/sdp`, `Content-Length: ${Buffer.byteLength(sdp)}`, '', sdp);
  return lines.join('\r\n');
}

function sendAck(call: CallRecord, responseText: string) {
  const to = getHeader(responseText, 'To') || `<${call.to}>`;
  const msg = [
    `ACK ${call.to} SIP/2.0`,
    `Via: SIP/2.0/UDP ${SIP_CONTACT_HOST}:${SIP_LOCAL_PORT};branch=${call.branch};rport`,
    `Max-Forwards: 70`,
    `From: <sip:${SIP_FROM_USER}@${SIP_DOMAIN}>;tag=${call.localTag}`,
    `To: ${to}`,
    `Call-ID: ${call.sipCallId}`,
    `CSeq: ${call.cseq} ACK`,
    `Content-Length: 0`,
    '',
  ].join('\r\n');
  sendRaw(msg);
}

function hangup(callId: string) {
  const call = calls.get(callId);
  if (!call) return;
  setStatus(callId, 'hangup_requested');
  const method = call.remoteTag ? 'BYE' : 'CANCEL';
  const cseq = method === 'CANCEL' ? call.cseq : call.cseq + 1;
  const to = call.remoteTag ? `<${call.to}>;tag=${call.remoteTag}` : `<${call.to}>`;
  const msg = [
    `${method} ${call.to} SIP/2.0`,
    `Via: SIP/2.0/UDP ${SIP_CONTACT_HOST}:${SIP_LOCAL_PORT};branch=${newBranch()};rport`,
    `Max-Forwards: 70`,
    `From: <sip:${SIP_FROM_USER}@${SIP_DOMAIN}>;tag=${call.localTag}`,
    `To: ${to}`,
    `Call-ID: ${call.sipCallId}`,
    `CSeq: ${cseq} ${method}`,
    `Contact: <sip:${SIP_FROM_USER}@${SIP_CONTACT_HOST}:${SIP_LOCAL_PORT}>`,
    `Content-Length: 0`,
    '',
  ].join('\r\n');
  sendRaw(msg);
}

function buildAuthorization(challenge: string, method: string, uri: string, headerName: string) {
  const p = parseDigestParams(challenge);
  const realm = p.realm;
  const nonce = p.nonce;
  const opaque = p.opaque;
  const qop = (p.qop || '').split(',')[0].trim() || undefined;
  if (!realm || !nonce) throw new Error('Digest realm/nonce manquant');
  const nc = '00000001';
  const cnonce = randomHex(8);
  const ha1 = md5(`${SIP_AUTH_USER}:${realm}:${SIP_PASSWORD}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  const parts = [
    `username="${SIP_AUTH_USER}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=MD5`,
  ];
  if (opaque) parts.push(`opaque="${opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `${headerName}: Digest ${parts.join(', ')}`;
}

function buildSdp() {
  const sessionId = Date.now();
  return [
    'v=0',
    `o=n8n ${sessionId} ${sessionId} IN IP4 ${RTP_IP}`,
    's=n8n SIP call',
    `c=IN IP4 ${RTP_IP}`,
    't=0 0',
    `m=audio ${RTP_PORT} RTP/AVP 0 8 101`,
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:8 PCMA/8000',
    'a=rtpmap:101 telephone-event/8000',
    'a=fmtp:101 0-16',
    'a=sendrecv',
    '',
  ].join('\r\n');
}

function sendRaw(msg: string) {
  console.log(`\n---> SIP to ${SIP_HOST}:${SIP_PORT} ---\n${msg}\n---`);
  socket.send(Buffer.from(msg, 'utf8'), SIP_PORT, SIP_HOST);
}

function parseStatus(msg: string) {
  const m = msg.match(/^SIP\/2\.0\s+(\d{3})\s*(.*)$/m);
  return m ? { code: Number(m[1]), reason: m[2] || '' } : null;
}
function getHeader(msg: string, name: string) {
  const re = new RegExp(`^${name}\\s*:\\s*(.+)$`, 'im');
  return msg.match(re)?.[1]?.trim();
}
function extractTag(header: string) { return header.match(/;tag=([^;\s]+)/)?.[1]; }
function parseDigestParams(header: string) {
  const out: Record<string, string> = {};
  const raw = header.replace(/^Digest\s+/i, '');
  const re = /(\w+)=("([^"]*)"|([^,\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out[m[1]] = m[3] ?? m[4] ?? '';
  return out;
}
function buildResponse(request: string, code: number, reason: string) {
  const via = getHeader(request, 'Via') || '';
  const from = getHeader(request, 'From') || '';
  const to = getHeader(request, 'To') || '';
  const callId = getHeader(request, 'Call-ID') || '';
  const cseq = getHeader(request, 'CSeq') || '';
  return [`SIP/2.0 ${code} ${reason}`, `Via: ${via}`, `From: ${from}`, `To: ${to}`, `Call-ID: ${callId}`, `CSeq: ${cseq}`, 'Content-Length: 0', '', ''].join('\r\n');
}
function normalizeSipUri(value: string) { return value.startsWith('sip:') ? value : `sip:${value}@${SIP_DOMAIN}`; }
function sipUser(uri: string) { return uri.replace(/^sip:/, '').split('@')[0]; }
function setStatus(callId: string, status: CallStatus, error?: string) { updateCall(callId, { status, error }); console.log(`[${callId}] ${status}${error ? `: ${error}` : ''}`); }
function updateCall(callId: string, patch: Partial<CallRecord>) { const c = calls.get(callId); if (c) calls.set(callId, { ...c, ...patch, updatedAt: new Date().toISOString() }); }
function md5(s: string) { return crypto.createHash('md5').update(s).digest('hex'); }
function randomHex(bytes: number) { return crypto.randomBytes(bytes).toString('hex'); }
function newBranch() { return `z9hG4bK-${randomHex(16)}`; }
function requiredEnv(name: string) { const v = process.env[name]; if (!v) throw new Error(`Missing required env var: ${name}`); return v; }
function getLocalAddress() { for (const addrs of Object.values(networkInterfaces())) for (const addr of addrs || []) if (addr.family === 'IPv4' && !addr.internal) return addr.address; return '127.0.0.1'; }

createServer(app).listen(PORT, () => console.log(`n8n raw SIP worker API listening on :${PORT}`));
