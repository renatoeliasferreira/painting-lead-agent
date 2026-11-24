import { readFileSync } from 'node:fs';

const { PUBLIC_URL, VAPI_API_KEY, VAPI_CREDENTIAL_ID } = process.env;
if (!PUBLIC_URL || !VAPI_API_KEY) throw new Error('Set PUBLIC_URL and VAPI_API_KEY');

const text = readFileSync(new URL('../config/assistant.json', import.meta.url), 'utf8');
const assistant = JSON.parse(text.replaceAll('{{PUBLIC_URL}}', PUBLIC_URL));

if (VAPI_CREDENTIAL_ID) {
  assistant.server.credentialId = VAPI_CREDENTIAL_ID;
  for (const tool of assistant.model.tools) tool.server.credentialId = VAPI_CREDENTIAL_ID;
}

const res = await fetch('https://api.vapi.ai/assistant', {
  method: 'POST',
  headers: { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(assistant),
});
const body = await res.json();
if (!res.ok) throw new Error(JSON.stringify(body));
console.log(`Created assistant ${body.id}. Put it in VAPI_ASSISTANT_ID.`);
