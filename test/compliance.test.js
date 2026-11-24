import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inCallWindow, nextWindowOpen, earliestCallTime } from '../src/compliance.js';

const ga = { timeZone: 'America/New_York', state: 'GA' };

test('evening in the window, late night out of it', () => {
  assert.equal(inCallWindow(new Date('2026-11-05T00:30:00Z'), ga), true);  // 7:30 PM ET
  assert.equal(inCallWindow(new Date('2026-11-05T02:30:00Z'), ga), false); // 9:30 PM ET
  assert.equal(inCallWindow(new Date('2026-11-05T12:59:00Z'), ga), false); // 7:59 AM ET
  assert.equal(inCallWindow(new Date('2026-11-05T13:00:00Z'), ga), true);  // 8:00 AM ET
});

test('uses the stricter state window', () => {
  const fl = { timeZone: 'America/New_York', state: 'FL' };
  assert.equal(inCallWindow(new Date('2026-11-05T01:30:00Z'), fl), false); // 8:30 PM ET
  assert.equal(inCallWindow(new Date('2026-11-05T01:30:00Z'), ga), true);
});

test('next window opens at 8 AM local time', () => {
  const open = nextWindowOpen(new Date('2026-11-05T04:30:00Z'), ga);
  assert.equal(open.toISOString(), '2026-11-05T13:00:00.000Z');
});

test('handles the day clocks change', () => {
  // Nov 1, 2026: US clocks go back. 8 AM EST is 13:00 UTC, not 12:00.
  const open = nextWindowOpen(new Date('2026-11-01T05:00:00Z'), ga);
  assert.equal(open.toISOString(), '2026-11-01T13:00:00.000Z');
});

test('call window can be switched off by the client', () => {
  const now = new Date('2026-11-05T04:30:00Z');
  const cfg = { ...ga, enforceCallWindow: false };
  assert.equal(earliestCallTime(now, cfg), now);
});
