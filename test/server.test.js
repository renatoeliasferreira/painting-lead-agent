import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { buildHandler } from '../src/server.js';
import { VapiVoice } from '../src/providers/vapi.js';
import { CalCalendar } from '../src/providers/cal.js';
import { TwilioSms } from '../src/providers/twilio.js';
import { harness } from './helpers.js';

const h = harness({
  env: {
    META_VERIFY_TOKEN: 'verify', META_APP_SECRET: 'appsecret', META_CONSENT_FORM_IDS: 'form1',
    WEBSITE_FORM_SECRET: 'formsecret', VAPI_WEBHOOK_SECRET: 'vapisecret',
  },
});
let server;
let base;

before(async () => {
  const getMetaLead = async () => ({ field_data: [
    { name: 'full_name', values: ['Sam Cole'] },
    { name: 'phone_number', values: ['+14045550188'] },
    { name: 'zip_code', values: ['30302'] },
  ] });
  server = createServer(buildHandler({ config: h.config, engine: h.engine, getMetaLead, notify: async () => {} }));
  await new Promise((r) => { server.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const settle = () => new Promise((r) => { setTimeout(r, 30); });

test('Meta verification handshake', async () => {
  const good = await fetch(`${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=123`);
  assert.equal(await good.text(), '123');
  const bad = await fetch(`${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=no&hub.challenge=123`);
  assert.equal(bad.status, 403);
});

const metaBody = JSON.stringify({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: 'L1', form_id: 'form1' } }] }] });

test('rejects an unsigned Meta event', async () => {
  const res = await fetch(`${base}/webhooks/meta`, { method: 'POST', body: metaBody, headers: { 'x-hub-signature-256': 'sha256=bad' } });
  assert.equal(res.status, 401);
  assert.equal(h.world.calls.length, 0);
});

test('a signed Meta event triggers a call', async () => {
  const sig = `sha256=${createHmac('sha256', 'appsecret').update(metaBody).digest('hex')}`;
  const res = await fetch(`${base}/webhooks/meta`, { method: 'POST', body: metaBody, headers: { 'x-hub-signature-256': sig } });
  assert.equal(res.status, 200);
  await settle();
  assert.equal(h.world.calls.length, 1);
  assert.equal(h.world.calls[0].phone, '+14045550188');
});

test('website form needs the secret and a submission id', async () => {
  const body = JSON.stringify({ submissionId: 'w1', name: 'Lee Park', phone: '404-555-0177', zip: '30301', consent: true });
  const denied = await fetch(`${base}/webhooks/website`, { method: 'POST', body });
  assert.equal(denied.status, 401);
  const noId = await fetch(`${base}/webhooks/website`, {
    method: 'POST', body: JSON.stringify({ phone: '404-555-0177' }), headers: { 'x-form-secret': 'formsecret' },
  });
  assert.equal(noId.status, 400);
  const ok = await fetch(`${base}/webhooks/website`, { method: 'POST', body, headers: { 'x-form-secret': 'formsecret' } });
  assert.equal(ok.status, 202);
  await settle();
  assert.equal(h.world.calls.length, 2);
});

test('Vapi tool call round trip, including string arguments', async () => {
  const leadId = h.world.calls[1].leadId;
  const res = await fetch(`${base}/webhooks/vapi`, {
    method: 'POST',
    headers: { Authorization: 'Bearer vapisecret' },
    body: JSON.stringify({ message: {
      type: 'tool-calls',
      call: { id: 'call_2', metadata: { leadId } },
      toolCallList: [{ id: 't1', function: { name: 'save_qualification', arguments: JSON.stringify({ job_type: 'both', property_type: 'house', timeline: 'soon', zip: '30301' }) } }],
    } }),
  });
  const { results } = await res.json();
  assert.equal(results[0].toolCallId, 't1');
  assert.equal(JSON.parse(results[0].result).qualified, true);
});

test('Vapi end-of-call report updates the lead; bad secret is refused', async () => {
  const leadId = h.world.calls[1].leadId;
  const body = JSON.stringify({ message: { type: 'end-of-call-report', endedReason: 'customer-ended-call', call: { id: 'call_2', metadata: { leadId } } } });
  assert.equal((await fetch(`${base}/webhooks/vapi`, { method: 'POST', body })).status, 401);
  assert.equal((await fetch(`${base}/webhooks/vapi`, { method: 'POST', body, headers: { Authorization: 'Bearer vapisecret' } })).status, 200);
  assert.equal(h.store.getLead(leadId).status, 'needs_human');
});

test('tool calls still find the lead when metadata is absent', async () => {
  const res = await fetch(`${base}/webhooks/vapi`, {
    method: 'POST',
    headers: { Authorization: 'Bearer vapisecret' },
    body: JSON.stringify({ message: {
      type: 'tool-calls',
      call: { id: 'call_1' },
      toolCallList: [{ id: 't2', function: { name: 'request_callback', arguments: { reason: 'prefers a person' } } }],
    } }),
  });
  const { results } = await res.json();
  assert.equal(JSON.parse(results[0].result).ok, true);
});

test('malformed JSON gets a 400', async () => {
  const res = await fetch(`${base}/webhooks/vapi`, { method: 'POST', body: '{', headers: { Authorization: 'Bearer vapisecret' } });
  assert.equal(res.status, 400);
});

test('provider clients send the documented request shapes', async () => {
  const seen = [];
  const fake = (payload) => async (url, init = {}) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), { status: 200 });
  };

  await new VapiVoice({ apiKey: 'k', assistantId: 'a', phoneNumberId: 'p' }, fake({ id: 'c1' }))
    .placeCall({ leadId: 'L', phone: '+14045550123', name: 'Dana', variables: { first_name: 'Dana' } });
  const vapi = JSON.parse(seen[0].init.body);
  assert.equal(seen[0].url, 'https://api.vapi.ai/call');
  assert.deepEqual(vapi.customer, { number: '+14045550123', name: 'Dana' });
  assert.equal(vapi.assistantOverrides.variableValues.first_name, 'Dana');
  assert.equal(vapi.metadata.leadId, 'L');

  const cal = new CalCalendar({ apiKey: 'k', username: 'u', eventSlug: 'e' }, fake({ data: { '2026-11-06': [{ start: 'A' }, 'B'] } }));
  const slots = await cal.getSlots({ start: new Date(0), end: new Date(1), timeZone: 'America/New_York' });
  assert.deepEqual(slots, ['A', 'B']);
  assert.equal(seen[1].init.headers['cal-api-version'], '2024-09-04');

  const cal2 = new CalCalendar({ apiKey: 'k', username: 'u', eventSlug: 'e' }, fake({ data: { id: 1, uid: 'x' } }));
  await cal2.book({ start: '2026-11-06T14:00:00Z', name: 'Dana', phone: '+14045550123', email: '', address: '12 Oak', timeZone: 'America/New_York', metadata: {} });
  const booking = JSON.parse(seen[2].init.body);
  assert.equal(seen[2].init.headers['cal-api-version'], '2026-02-25');
  assert.deepEqual(booking.location, { type: 'attendeeAddress', address: '12 Oak' });
  assert.equal('email' in booking.attendee, false);

  await new TwilioSms({ accountSid: 'AC1', authToken: 't', messagingServiceSid: 'MG1' }, fake({}))
    .send({ to: '+14045550123', body: 'hi' });
  assert.match(seen[3].url, /Accounts\/AC1\/Messages\.json$/);
  assert.equal(seen[3].init.body.get('MessagingServiceSid'), 'MG1');
});
