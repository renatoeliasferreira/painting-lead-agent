// Turns Meta and website payloads into one lead shape.

// The client serves US homes, so anything else goes to a person instead of the dialer.
export function toE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (String(raw).trim().startsWith('+') && !(digits.length === 11 && digits.startsWith('1'))) return null;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? `+1${national}` : null;
}

const titleCase = (s) =>
  s.trim().toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

function splitName(fullName, firstName, lastName) {
  const full = (fullName || [firstName, lastName].filter(Boolean).join(' ')).trim();
  if (!full) return { name: '', firstName: '' };
  const name = titleCase(full);
  return { name, firstName: name.split(/\s+/)[0] };
}

const zip5 = (v) => (String(v ?? '').match(/\b\d{5}\b/) || [null])[0];

export function fromMeta(apiLead, { formId, leadgenId, consentFormIds = [] }) {
  const f = Object.fromEntries((apiLead.field_data || []).map((x) => [x.name, x.values?.[0] ?? '']));
  return {
    source: 'facebook',
    externalId: leadgenId,
    formId,
    ...splitName(f.full_name, f.first_name, f.last_name),
    phone: toE164(f.phone_number),
    rawPhone: f.phone_number || '',
    email: (f.email || '').trim().toLowerCase(),
    zip: zip5(f.zip_code || f.post_code),
    address: f.street_address || '',
    jobHint: f.job_type || f.project_type || '',
    consent: consentFormIds.includes(formId),
  };
}

export function fromWebsite(body) {
  return {
    source: 'website',
    externalId: String(body.submissionId || ''),
    formId: 'website',
    ...splitName(body.name, body.firstName, body.lastName),
    phone: toE164(body.phone),
    rawPhone: body.phone || '',
    email: (body.email || '').trim().toLowerCase(),
    zip: zip5(body.zip),
    address: body.address || '',
    jobHint: body.message || '',
    consent: body.consent === true,
  };
}

// Form text reaches the agent's prompt, so only safe, known values may pass through.
export function promptSafeName(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return /^[\p{L}'-]{1,30}$/u.test(first) ? first : 'there';
}

export function promptSafeJob(text) {
  const t = String(text || '').toLowerCase();
  const interior = /\b(interior|inside|indoor|room|rooms|bedroom|kitchen|cabinet|cabinets)\b/.test(t);
  const exterior = /\b(exterior|outside|outdoor|siding|fence|deck|trim)\b/.test(t);
  if (interior && exterior) return 'an interior and exterior painting project';
  if (interior) return 'an interior painting project';
  if (exterior) return 'an exterior painting project';
  return 'a painting project';
}
