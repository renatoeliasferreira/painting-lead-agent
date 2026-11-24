import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toE164, fromMeta, fromWebsite } from '../src/lead.js';

test('normalizes common US phone formats', () => {
  for (const v of ['(404) 555-0123', '404.555.0123', '1 404 555 0123', '+1 404-555-0123']) {
    assert.equal(toE164(v), '+14045550123');
  }
});

test('rejects numbers that cannot be dialed safely', () => {
  for (const v of ['', null, '555-0123', '123-456-7890', '+44 20 7946 0958', '404-555-012']) {
    assert.equal(toE164(v), null);
  }
});

test('maps Meta field_data and only trusts reviewed forms for consent', () => {
  const api = { field_data: [
    { name: 'full_name', values: ['dana REED'] },
    { name: 'phone_number', values: ['+14045550123'] },
    { name: 'email', values: ['Dana@Example.com '] },
    { name: 'zip_code', values: ['30301-1234'] },
  ] };
  const ok = fromMeta(api, { formId: 'f1', leadgenId: 'l1', consentFormIds: ['f1'] });
  assert.equal(ok.name, 'Dana Reed');
  assert.equal(ok.firstName, 'Dana');
  assert.equal(ok.email, 'dana@example.com');
  assert.equal(ok.zip, '30301');
  assert.equal(ok.consent, true);
  assert.equal(fromMeta(api, { formId: 'f2', leadgenId: 'l1', consentFormIds: ['f1'] }).consent, false);
});

test('website consent must be literally true', () => {
  assert.equal(fromWebsite({ submissionId: 'a', phone: '4045550123', consent: 'yes' }).consent, false);
  assert.equal(fromWebsite({ submissionId: 'a', phone: '4045550123', consent: true }).consent, true);
});
