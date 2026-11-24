export function slackNotifier(url, fetchFn = fetch) {
  return async (text) => {
    if (!url) { console.log(`[team alert] ${text}`); return; }
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) console.error(`Slack alert failed with ${res.status}: ${text}`);
    } catch (err) {
      console.error(`Slack alert failed: ${err.message}: ${text}`);
    }
  };
}
