export class VapiVoice {
  constructor(cfg, fetchFn = fetch) { this.cfg = cfg; this.fetch = fetchFn; }

  async placeCall({ leadId, phone, name, variables }) {
    const res = await this.fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistantId: this.cfg.assistantId,
        phoneNumberId: this.cfg.phoneNumberId,
        customer: { number: phone, ...(name ? { name } : {}) },
        assistantOverrides: { variableValues: variables },
        metadata: { leadId },
      }),
    });
    if (!res.ok) throw new Error(`Vapi ${res.status}: ${await res.text()}`);
    return { id: (await res.json()).id };
  }
}
