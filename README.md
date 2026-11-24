# Painting lead agent

Calls a home painting lead right after a Facebook or website form, qualifies them, and books an estimate.

**Status:** tested against simulated providers. It has not placed a real call yet, and the voice conversation has not been tested with a live model.

## What happens

1. A signed Meta webhook or a website form post arrives.
2. The service checks for duplicates, a valid US phone, consent and the do-not-call list.
3. If the call window is open, Vapi calls at once. Otherwise the call is held until it opens.
4. The agent qualifies the lead through tools, offers real Cal.com times, and books one.
5. The lead gets a text confirmation and the team gets an alert.
6. No answer: one text, a retry after 20 minutes, a final try a day later, then a team alert.

The rules that matter live in code rather than the prompt: the call window, consent, opt-outs, qualification before booking, and booking only times the calendar returned.

## Try it

Node 20 or later, no dependencies.

```bash
npm test
npm run demo
```

## Go live

1. Copy `.env.example` to `.env` and fill it in.
2. In Cal.com, create the estimate event type with attendee address as a location option.
3. In Vapi, buy or import a number, then add a Bearer Token credential that matches `VAPI_WEBHOOK_SECRET`. Enable voicemail detection on the assistant.
4. Deploy the service at a public HTTPS URL and set `PUBLIC_URL`.
5. Run `npm run create-assistant` and set `VAPI_ASSISTANT_ID`.
6. In the Meta app, subscribe the Page to `leadgen` at `/webhooks/meta`. Add reviewed forms to `META_CONSENT_FORM_IDS`.
7. Post the website form to `/webhooks/website` with `X-Form-Secret`, `submissionId`, `name`, `phone`, `zip` and `consent: true`.
8. Complete A2P 10DLC registration for the Twilio sender.

Check that the assistant's `model` is available in your Vapi account. If not, pick the fastest supported option.

## Call window

`ENFORCE_CALL_WINDOW=true` limits calls to 8 AM to 9 PM in the client's time zone, with stricter starter values for FL and CT. Set it to `false` only after the client and their counsel approve overnight calls. The values in `src/compliance.js` are a starting point, not legal advice.

## Known limits

See the written assessment for the full list. In short: single client, single time zone, JSON-file storage, no inbound SMS or STOP webhook, no callback or rescheduling flow, and no live human transfer.
