import express from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(express.json({ limit: '1mb' }));

const API_KEY = process.env.SIP_WORKER_API_KEY || 'change-me';
const PORT = Number(process.env.PORT || 3008);

type CallStatus = 'queued' | 'ringing' | 'answered' | 'completed' | 'failed' | 'hangup_requested';

type CallRecord = {
  callId: string;
  to: string;
  from?: string;
  audioUrl?: string;
  status: CallStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: unknown;
};

const calls = new Map<string, CallRecord>();

app.use((req, res, next) => {
  const auth = req.header('authorization') || '';
  if (auth !== `Bearer ${API_KEY}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/calls', async (req, res) => {
  const { to, from, audioUrl, metadata } = req.body || {};
  if (!to || typeof to !== 'string') {
    res.status(400).json({ error: 'Missing required field: to' });
    return;
  }

  const now = new Date().toISOString();
  const call: CallRecord = {
    callId: randomUUID(),
    to,
    from,
    audioUrl,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    metadata,
  };
  calls.set(call.callId, call);

  // TODO: Replace this simulation with real SIP.js/WebRTC code.
  // In production, register a SIP UserAgent, create an Inviter, and update status from session events.
  setTimeout(() => updateStatus(call.callId, 'ringing'), 500);
  setTimeout(() => updateStatus(call.callId, 'answered'), 1500);

  res.status(202).json(call);
});

app.get('/calls/:callId', (req, res) => {
  const call = calls.get(req.params.callId);
  if (!call) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  res.json(call);
});

app.post('/calls/:callId/hangup', (req, res) => {
  const call = calls.get(req.params.callId);
  if (!call) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  updateStatus(call.callId, 'hangup_requested');
  // TODO: call SIP.js session.bye() or session.cancel() depending on current state.
  res.json(calls.get(call.callId));
});

app.post('/calls/:callId/dtmf', (req, res) => {
  const call = calls.get(req.params.callId);
  if (!call) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  const { digits } = req.body || {};
  if (!digits || typeof digits !== 'string') {
    res.status(400).json({ error: 'Missing required field: digits' });
    return;
  }
  // TODO: call SIP.js session.sessionDescriptionHandler.sendDtmf(digits) or equivalent for your SIP.js version.
  res.json({ ...call, dtmfSent: digits });
});

function updateStatus(callId: string, status: CallStatus) {
  const call = calls.get(callId);
  if (!call) return;
  calls.set(callId, { ...call, status, updatedAt: new Date().toISOString() });
}

app.listen(PORT, () => {
  console.log(`SIP worker listening on :${PORT}`);
});
