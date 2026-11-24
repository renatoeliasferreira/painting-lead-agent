import { earliestCallTime, inCallWindow, nextWindowOpen } from './compliance.js';
import { promptSafeJob, promptSafeName } from './lead.js';

const NO_CONTACT = new Set(['customer-did-not-answer', 'customer-busy', 'voicemail']);
const CONNECTED = /^(customer-ended-call|assistant-ended-call|assistant-said-end-call-phrase|exceeded-max-duration|silence-timed-out)/;
const COMMERCIAL_ALLOWED = false;

const spoken = (iso, timeZone) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));

export class Engine {
  constructor({ config, store, voice, calendar, sms, notify, clock = () => new Date() }) {
    Object.assign(this, { config, store, voice, calendar, sms, notify, clock });
  }

  // ---------- Intake ----------
  async intake(input) {
    const now = this.clock();
    if (input.externalId && !this.store.firstSeen(`lead:${input.source}:${input.externalId}`, now)) {
      return { duplicate: true };
    }

    if (input.phone) {
      const open = this.store.findOpenByPhone(input.phone);
      if (open) {
        this.store.updateLead(open.id, { resubmittedAt: now.toISOString() });
        return { duplicate: true, leadId: open.id };
      }
      const resolved = this.store.findRecentResolved(input.phone, now);
      if (resolved) {
        await this.notify(`${resolved.name || input.phone} submitted again and is already ${resolved.status}.`);
        return { duplicate: true, leadId: resolved.id };
      }
    }

    const lead = this.store.addLead({
      ...input, status: 'new', attempts: 0, callIds: [], createdAt: now.toISOString(), history: [],
    });

    if (!input.phone) return this.#toHuman(lead, `No valid phone number (got "${input.rawPhone}")`);
    if (!input.consent) return this.#toHuman(lead, 'No reviewed consent for automated calls');
    if (this.store.isSuppressed(input.phone)) {
      this.#log(lead, 'Phone is on the do-not-call list');
      return this.store.updateLead(lead.id, { status: 'do_not_call' });
    }

    const at = earliestCallTime(now, this.config);
    this.store.updateLead(lead.id, { status: 'queued', nextAttemptAt: at.toISOString() });
    if (at > now) this.#log(lead, `Outside call window, first call held until ${at.toISOString()}`);
    await this.tick();
    return this.store.getLead(lead.id);
  }

  // ---------- Dialing ----------
  async tick() {
    const now = this.clock();
    for (const lead of this.store.allLeads()) {
      if (lead.status === 'calling' && now - new Date(lead.lastCallAt) > this.config.staleCallMinutes * 60000) {
        await this.#toHuman(lead, 'No end-of-call report arrived for the last call');
      }
      if (lead.status === 'queued' && new Date(lead.nextAttemptAt) <= now) await this.#dial(lead, now);
    }
  }

  async #dial(lead, now) {
    if (this.store.isSuppressed(lead.phone)) {
      this.store.updateLead(lead.id, { status: 'do_not_call' });
      return;
    }
    if (this.config.enforceCallWindow) {
      const cfg = { timeZone: this.config.timeZone, state: this.config.state };
      if (!inCallWindow(now, cfg)) {
        this.store.updateLead(lead.id, { nextAttemptAt: nextWindowOpen(now, cfg).toISOString() });
        return;
      }
    }

    this.store.updateLead(lead.id, {
      status: 'calling', attempts: lead.attempts + 1, lastCallAt: now.toISOString(),
    });
    try {
      const { id } = await this.voice.placeCall({
        leadId: lead.id,
        phone: lead.phone,
        name: lead.name,
        variables: {
          first_name: promptSafeName(lead.firstName),
          company: this.config.companyName,
          job_hint: promptSafeJob(lead.jobHint),
          source: lead.source === 'facebook' ? 'our Facebook form' : 'our website',
        },
      });
      this.store.updateLead(lead.id, { callIds: [...lead.callIds, id] });
      this.#log(lead, `Call attempt ${lead.attempts} placed`);
    } catch (err) {
      this.#log(lead, `Call failed to start: ${err.message}`);
      await this.#retryOrClose(lead, now, false);
    }
  }

  async #retryOrClose(lead, now, textAfterFirstMiss) {
    if (lead.attempts >= this.config.maxAttempts) {
      this.store.updateLead(lead.id, { status: 'unreached' });
      await this.notify(`Could not reach ${lead.name || lead.phone} after ${lead.attempts} attempts.`);
      return;
    }
    const minutes = this.config.retryDelaysMinutes[lead.attempts - 1] ?? 1440;
    const at = earliestCallTime(new Date(now.getTime() + minutes * 60000), this.config);
    this.store.updateLead(lead.id, { status: 'queued', nextAttemptAt: at.toISOString() });
    if (textAfterFirstMiss && lead.attempts === 1 && earliestCallTime(now, this.config) <= now) {
      await this.#text(lead, `Hi ${lead.firstName || 'there'}, this is ${this.config.companyName}. We just tried calling about your painting estimate. Reply here or call us back when it suits you. Reply STOP to opt out.`);
    }
  }

  // ---------- Call result ----------
  async onCallEnded({ callId, leadId, endedReason, summary }) {
    const now = this.clock();
    if (!this.store.firstSeen(`end:${callId}`, now)) return;
    const lead = (leadId && this.store.getLead(leadId)) || this.store.findByCallId(callId);
    if (!lead) return;

    this.#log(lead, `Call ended: ${endedReason}`);
    if (lead.status !== 'calling') return; // Booked, opted out, or already handled.

    if (NO_CONTACT.has(endedReason)) return this.#retryOrClose(lead, now, true);
    if (CONNECTED.test(endedReason)) {
      return this.#toHuman(lead, `Call ended without a booking. ${summary || ''}`.trim());
    }
    return this.#retryOrClose(lead, now, false);
  }

  leadIdForCall(callId) {
    return this.store.findByCallId(callId)?.id || null;
  }

  // ---------- Tools the voice agent can call ----------
  async runTool(name, args, leadId) {
    const lead = this.store.getLead(leadId);
    if (!lead) return { ok: false, say: 'Apologize and say someone from the team will call back.' };
    try {
      const handler = {
        save_qualification: () => this.#saveQualification(lead, args),
        check_availability: () => this.#checkAvailability(lead),
        book_estimate: () => this.#book(lead, args),
        mark_do_not_call: () => this.#doNotCall(lead),
        request_callback: () => this.#callback(lead, args),
      }[name];
      if (!handler) return { ok: false, say: `Unknown tool ${name}.` };
      return await handler();
    } catch (err) {
      await this.notify(`Tool ${name} failed for ${lead.phone}: ${err.message}`);
      return { ok: false, say: 'Apologize, offer a callback from the team, and use request_callback.' };
    }
  }

  async #saveQualification(lead, a) {
    const zip = a.zip || lead.zip;
    const { serviceZips } = this.config;
    const inArea = !serviceZips.length || serviceZips.includes(zip);
    const residential = a.property_type !== 'commercial' || COMMERCIAL_ALLOWED;
    const missing = ['job_type', 'property_type', 'timeline'].filter((k) => !a[k]);
    if (!zip) missing.push('zip');

    const qualified = !missing.length && inArea && residential;
    this.store.updateLead(lead.id, {
      zip, address: a.address || lead.address, qualification: { ...a, zip, qualified },
    });

    if (missing.length) return { ok: false, qualified: false, say: `Still need: ${missing.join(', ')}.` };
    if (!inArea) {
      this.store.updateLead(lead.id, { status: 'disqualified' });
      return { ok: true, qualified: false, say: 'Outside the service area. Say so kindly, offer no booking, and end the call.' };
    }
    if (!residential) return { ok: true, qualified: false, say: 'Commercial job. Use request_callback so the team can follow up.' };
    return { ok: true, qualified: true, say: 'Qualified. Check availability next.' };
  }

  async #checkAvailability(lead) {
    if (!lead.qualification?.qualified) return { ok: false, say: 'Finish qualification first.' };
    const now = this.clock();
    const end = new Date(now.getTime() + this.config.lookaheadDays * 86400000);
    const slots = await this.calendar.getSlots({ start: now, end, timeZone: this.config.timeZone });
    const offered = spacedOut(slots, 3);
    this.store.updateLead(lead.id, { offeredSlots: offered });
    if (!offered.length) return { ok: false, say: 'No openings found. Use request_callback.' };
    return {
      ok: true,
      slots: offered.map((start) => ({ start, spoken: spoken(start, this.config.timeZone) })),
    };
  }

  async #book(lead, a) {
    if (lead.booking) return { ok: true, spoken: spoken(lead.booking.start, this.config.timeZone), say: 'Already booked.' };
    if (!lead.qualification?.qualified) return { ok: false, say: 'Finish qualification first.' };
    if (!lead.offeredSlots?.includes(a.start)) return { ok: false, say: 'Offer only times returned by check_availability.' };
    const address = a.address || lead.address;
    if (!address) return { ok: false, say: 'Ask for the full property address first.' };

    let booking;
    try {
      booking = await this.calendar.book({
        start: a.start,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        address,
        timeZone: this.config.timeZone,
        metadata: {
          leadId: lead.id,
          jobType: lead.qualification.job_type,
          timeline: lead.qualification.timeline,
        },
      });
    } catch (err) {
      this.store.updateLead(lead.id, { offeredSlots: [] });
      this.#log(lead, `Booking failed: ${err.message}`);
      return { ok: false, say: 'That time was just taken. Apologize and call check_availability again.' };
    }

    this.store.updateLead(lead.id, { status: 'booked', address, booking: { ...booking, start: a.start } });
    const when = spoken(a.start, this.config.timeZone);
    await this.#text(lead, `You're booked: ${this.config.companyName} estimate on ${when} at ${address}. Reply here to change it. Reply STOP to opt out.`);
    await this.notify(`New estimate booked: ${lead.name}, ${when}, ${address}.`);
    return { ok: true, spoken: when, say: 'Booked. Confirm the time and address, then close the call.' };
  }

  async #doNotCall(lead) {
    this.store.suppress(lead.phone, this.clock());
    this.store.updateLead(lead.id, { status: 'do_not_call' });
    return { ok: true, say: 'Confirm they will not be contacted again, then end the call.' };
  }

  async #callback(lead, a) {
    this.store.updateLead(lead.id, { status: 'callback_requested' });
    await this.notify(`Callback requested by ${lead.name || lead.phone} (${lead.phone}): ${a.reason || 'no reason given'}`);
    return { ok: true, say: 'Tell them the team will call during business hours, then close the call.' };
  }

  // ---------- Helpers ----------
  async #toHuman(lead, reason) {
    this.#log(lead, reason);
    this.store.updateLead(lead.id, { status: 'needs_human' });
    await this.notify(`Lead needs a person: ${lead.name || 'Unknown'} (${lead.phone || lead.rawPhone || 'no phone'}). ${reason}`);
    return this.store.getLead(lead.id);
  }

  async #text(lead, body) {
    try {
      await this.sms.send({ to: lead.phone, body });
    } catch (err) {
      await this.notify(`SMS failed for ${lead.phone}: ${err.message}`);
    }
  }

  #log(lead, message) {
    const current = this.store.getLead(lead.id);
    this.store.updateLead(lead.id, {
      history: [...(current.history || []), { at: this.clock().toISOString(), message }],
    });
  }
}

// Offers times on different days where possible, so the choice feels real.
function spacedOut(slots, count) {
  const sorted = [...slots].sort();
  const byDay = new Map();
  for (const s of sorted) if (!byDay.has(s.slice(0, 10))) byDay.set(s.slice(0, 10), s);
  const picks = [...byDay.values()].slice(0, count);
  for (const s of sorted) {
    if (picks.length >= count) break;
    if (!picks.includes(s)) picks.push(s);
  }
  return picks.sort();
}
