const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    publicUrl: env.PUBLIC_URL || 'http://localhost:3000',
    dataFile: env.DATA_FILE || './data/leads.json',
    companyName: env.COMPANY_NAME || 'Brightside Painting',
    timeZone: env.CLIENT_TIMEZONE || 'America/New_York',
    state: (env.CLIENT_STATE || '').toUpperCase(),
    serviceZips: list(env.SERVICE_ZIPS),
    lookaheadDays: Number(env.BOOKING_LOOKAHEAD_DAYS || 7),
    enforceCallWindow: env.ENFORCE_CALL_WINDOW !== 'false',
    maxAttempts: Number(env.MAX_CALL_ATTEMPTS || 3),
    retryDelaysMinutes: list(env.RETRY_DELAYS_MINUTES || '20,1440').map(Number),
    staleCallMinutes: 20,
    meta: {
      verifyToken: env.META_VERIFY_TOKEN,
      appSecret: env.META_APP_SECRET,
      accessToken: env.META_PAGE_ACCESS_TOKEN,
      graphVersion: env.META_GRAPH_VERSION || 'v26.0',
      consentFormIds: list(env.META_CONSENT_FORM_IDS),
    },
    websiteFormSecret: env.WEBSITE_FORM_SECRET,
    vapi: {
      apiKey: env.VAPI_API_KEY,
      assistantId: env.VAPI_ASSISTANT_ID,
      phoneNumberId: env.VAPI_PHONE_NUMBER_ID,
      webhookSecret: env.VAPI_WEBHOOK_SECRET,
    },
    cal: { apiKey: env.CAL_API_KEY, username: env.CAL_USERNAME, eventSlug: env.CAL_EVENT_SLUG },
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
    },
    slackWebhookUrl: env.SLACK_WEBHOOK_URL,
  };
}
