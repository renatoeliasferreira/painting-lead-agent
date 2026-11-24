import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, lead } from './helpers.js';

const a = JSON.parse(readFileSync(new URL('../config/assistant.json', import.meta.url), 'utf8'));

test('every tool in the assistant has a handler', async () => {
  const h = harness();
  await h.engine.intake(lead());
  const id = h.store.allLeads()[0].id;
  for (const t of a.model.tools) {
    const r = await h.engine.runTool(t.function.name, {}, id);
    assert.doesNotMatch(r.say || '', /Unknown tool/, t.function.name);
  }
});

test('the opening line discloses AI and the reason for the call', () => {
  assert.match(a.firstMessage, /AI assistant/);
  assert.match(a.firstMessage, /\{\{company\}\}/);
  assert.match(a.firstMessage, /may be recorded/);
});
