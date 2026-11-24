import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { fromMeta, fromWebsite } from './lead.js';
import { VapiVoice } from './providers/vapi.js';
import { CalCalendar } from './providers/cal.js';
import { TwilioSms } from './providers/twilio.js';
import { fetchMetaLead } from './providers/meta.js';
import { slackNotifier } from './providers/notify.js';

const MAX_BODY = 1_000_000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyMetaSignature(raw, header, secret) {
  if (!secret) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return safeEqual(header, expected);
}

const parseArgs = (a) => {
  if (typeof a !== 'string') return a || {};
  try { return JSON.parse(a); } catch { return {}; }
};

export function buildHandler({ config, engine, getMetaLead, notify }) {
  const send = (res, status, body = '') => {
    const json = typeof body === 'object';
    res.writeHead(status, { 'Content-Type': json ? 'application/json' : 'text/plain' });
    res.end(json ? JSON.stringify(body) : body);
  };

  async function processMetaEvent(value) {
    const { leadgen_id: leadgenId, form_id: formId } = value;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const apiLead = await getMetaLead(leadgenId);
        await engine.intake(fromMeta(apiLead, {
          formId, leadgenId, consentFormIds: config.meta.consentFormIds,
        }));
        return;
      } catch (err) {
        if (attempt === 3) {
          await notify(`Could not load Facebook lead ${leadgenId}: ${err.message}`);
          return;
        }
        await new Promise((r) => { setTimeout(r, 500 * attempt); });
      }
    }
  }

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, 'ok');

      if (req.method === 'GET' && url.pathname === '/webhooks/meta') {
        const ok = url.searchParams.get('hub.mode') === 'subscribe'
          && safeEqual(url.searchParams.get('hub.verify_token'), config.meta.verifyToken);
        return ok ? send(res, 200, url.searchParams.get('hub.challenge')) : send(res, 403);
      }

      if (req.method !== 'POST') return send(res, 404);
      const raw = await readBody(req);

      if (url.pathname === '/webhooks/meta') {
        if (!verifyMetaSignature(raw, req.headers['x-hub-signature-256'], config.meta.appSecret)) return send(res, 401);
        const body = JSON.parse(raw);
        const events = (body.entry || []).flatMap((e) => e.changes || []).filter((c) => c.field === 'leadgen');
        send(res, 200, 'EVENT_RECEIVED'); // Acknowledge first, then do the slower work.
        await Promise.all(events.map((c) => processMetaEvent(c.value)));
        return undefined;
      }

      if (url.pathname === '/webhooks/website') {
        if (!safeEqual(req.headers['x-form-secret'], config.websiteFormSecret)) return send(res, 401);
        const lead = fromWebsite(JSON.parse(raw));
        if (!lead.externalId) return send(res, 400, 'submissionId is required');
        send(res, 202, { received: true });
        await engine.intake(lead);
        return undefined;
      }

      if (url.pathname === '/webhooks/vapi') {
        const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!safeEqual(token, config.vapi.webhookSecret)) return send(res, 401);
        const { message = {} } = JSON.parse(raw);
        const leadId = message.call?.metadata?.leadId || engine.leadIdForCall(message.call?.id);

        if (message.type === 'tool-calls') {
          const results = [];
          for (const call of message.toolCallList || []) {
            const result = await engine.runTool(call.function?.name, parseArgs(call.function?.arguments), leadId);
            results.push({ toolCallId: call.id, name: call.function?.name, result: JSON.stringify(result) });
          }
          return send(res, 200, { results });
        }

        if (message.type === 'end-of-call-report') {
          await engine.onCallEnded({
            callId: message.call?.id,
            leadId,
            endedReason: message.endedReason,
            summary: message.summary || message.analysis?.summary,
          });
        }
        return send(res, 200, { received: true });
      }

      return send(res, 404);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, err instanceof SyntaxError ? 400 : 500);
      return undefined;
    }
  };
}

export function startServer(config = loadConfig()) {
  const store = new Store(config.dataFile);
  const notify = slackNotifier(config.slackWebhookUrl);
  const engine = new Engine({
    config,
    store,
    notify,
    voice: new VapiVoice(config.vapi),
    calendar: new CalCalendar(config.cal),
    sms: new TwilioSms(config.twilio),
  });
  const handler = buildHandler({
    config, engine, notify, getMetaLead: (id) => fetchMetaLead(id, config.meta),
  });
  const server = createServer(handler);
  server.listen(config.port, () => console.log(`Listening on ${config.port}`));
  const timer = setInterval(() => engine.tick().catch(console.error), 30000);
  server.on('close', () => clearInterval(timer));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
