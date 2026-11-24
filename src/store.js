// Small JSON-file store for the starter. Swap for Postgres before running at volume.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(file = null) {
    this.file = file;
    this.state = { leads: {}, suppressed: {}, seenEvents: {} };
    if (file && existsSync(file)) this.state = JSON.parse(readFileSync(file, 'utf8'));
  }

  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }

  // Returns true the first time a key is seen.
  firstSeen(key, now) {
    if (this.state.seenEvents[key]) return false;
    this.state.seenEvents[key] = now.toISOString();
    this.save();
    return true;
  }

  addLead(lead) {
    const id = randomUUID();
    this.state.leads[id] = { id, ...lead };
    this.save();
    return this.state.leads[id];
  }

  getLead(id) { return this.state.leads[id] || null; }
  allLeads() { return Object.values(this.state.leads); }

  updateLead(id, patch) {
    Object.assign(this.state.leads[id], patch);
    this.save();
    return this.state.leads[id];
  }

  findByCallId(callId) {
    return this.allLeads().find((l) => l.callIds?.includes(callId)) || null;
  }

  findOpenByPhone(phone) {
    const open = ['queued', 'calling'];
    return this.allLeads().find((l) => l.phone === phone && open.includes(l.status)) || null;
  }

  findRecentResolved(phone, now, days = 30) {
    const statuses = ['booked', 'callback_requested'];
    const cutoff = now.getTime() - days * 86400000;
    return this.allLeads().find((l) => l.phone === phone && statuses.includes(l.status)
      && new Date(l.createdAt).getTime() >= cutoff) || null;
  }

  isSuppressed(phone) { return Boolean(this.state.suppressed[phone]); }

  suppress(phone, now) {
    this.state.suppressed[phone] = now.toISOString();
    this.save();
  }
}
