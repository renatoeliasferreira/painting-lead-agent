export class TwilioSms {
  constructor(cfg, fetchFn = fetch) { this.cfg = cfg; this.fetch = fetchFn; }

  async send({ to, body }) {
    const { accountSid, authToken, messagingServiceSid } = this.cfg;
    const res = await this.fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, Body: body, MessagingServiceSid: messagingServiceSid }),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
  }
}
