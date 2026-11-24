const API = 'https://api.cal.com/v2';

export class CalCalendar {
  constructor(cfg, fetchFn = fetch) { this.cfg = cfg; this.fetch = fetchFn; }

  async getSlots({ start, end, timeZone }) {
    const q = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      eventTypeSlug: this.cfg.eventSlug,
      username: this.cfg.username,
      timeZone,
    });
    const res = await this.fetch(`${API}/slots?${q}`, {
      headers: { 'cal-api-version': '2024-09-04', Authorization: `Bearer ${this.cfg.apiKey}` },
    });
    if (!res.ok) throw new Error(`Cal slots ${res.status}: ${await res.text()}`);
    const { data } = await res.json();
    return Object.values(data || {}).flat().map((s) => (typeof s === 'string' ? s : s.start));
  }

  async book({ start, name, phone, email, address, timeZone, metadata }) {
    const res = await this.fetch(`${API}/bookings`, {
      method: 'POST',
      headers: {
        'cal-api-version': '2026-02-25',
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        start: new Date(start).toISOString(),
        eventTypeSlug: this.cfg.eventSlug,
        username: this.cfg.username,
        attendee: { name: name || 'Estimate lead', timeZone, phoneNumber: phone, ...(email ? { email } : {}) },
        location: { type: 'attendeeAddress', address },
        metadata,
      }),
    });
    if (!res.ok) throw new Error(`Cal booking ${res.status}: ${await res.text()}`);
    const { data } = await res.json();
    return { id: data.id, uid: data.uid };
  }
}
