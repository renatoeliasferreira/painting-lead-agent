// Runs the agent's logic against simulated providers. No real calls, texts or bookings.
import { harness, lead, qual } from '../test/helpers.js';

const et = (d) => new Date(d).toLocaleString('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
});
const line = (h, t) => console.log(`  ${et(h.world.now).padEnd(16)} ${t}`);

async function evening() {
  console.log('\n1. Facebook lead at 6:40 PM, after business hours');
  const h = harness();
  await h.engine.intake(lead({ source: 'facebook' }));
  const id = h.store.allLeads()[0].id;
  line(h, `Form received, call placed at once to ${h.world.calls[0].phone}`);
  await h.engine.runTool('save_qualification', qual, id);
  line(h, 'Agent saved job details: qualified');
  const { slots } = await h.engine.runTool('check_availability', {}, id);
  line(h, `Agent offered: ${slots.map((s) => s.spoken).join(' / ')}`);
  const r = await h.engine.runTool('book_estimate', { start: slots[0].start, address: '12 Oak St, Atlanta' }, id);
  line(h, `Booked ${r.spoken}`);
  line(h, `Text sent: ${h.world.texts[0].body}`);
  line(h, `Team alert: ${h.world.alerts[0]}`);
}

async function overnight() {
  console.log('\n2. Website lead at 2:00 AM with the call window on');
  const h = harness({ at: '2026-11-05T07:00:00Z' });
  await h.engine.intake(lead());
  line(h, `Form received, ${h.world.calls.length} calls placed, held for the morning`);
  await h.advance(360);
  line(h, `${h.world.calls.length} call placed as the window opened`);
}

async function noAnswer() {
  console.log('\n3. Lead does not answer');
  const h = harness({ at: '2026-11-04T15:00:00Z' });
  await h.engine.intake(lead());
  const id = h.store.allLeads()[0].id;
  line(h, 'Call 1 placed');
  await h.engine.onCallEnded({ callId: 'call_1', leadId: id, endedReason: 'customer-did-not-answer' });
  line(h, 'No answer, follow-up text sent');
  await h.advance(20);
  line(h, 'Call 2 placed');
  await h.engine.onCallEnded({ callId: 'call_2', leadId: id, endedReason: 'voicemail' });
  await h.advance(1440);
  line(h, 'Call 3 placed');
  await h.engine.onCallEnded({ callId: 'call_3', leadId: id, endedReason: 'customer-busy' });
  line(h, `Stopped after ${h.world.calls.length} attempts. Team alert: ${h.world.alerts[0]}`);
}

async function optOut() {
  console.log('\n4. Lead says stop calling');
  const h = harness();
  await h.engine.intake(lead());
  await h.engine.runTool('mark_do_not_call', {}, h.store.allLeads()[0].id);
  line(h, 'Phone added to the do-not-call list');
  await h.engine.intake(lead({ externalId: 'sub_2' }));
  line(h, `Same person submits again: ${h.world.calls.length} call in total, no new call placed`);
}

await evening();
await overnight();
await noAnswer();
await optOut();
console.log('\nSimulated run. No real calls, texts or bookings were made.\n');
