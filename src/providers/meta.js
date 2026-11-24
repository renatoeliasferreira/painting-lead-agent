export async function fetchMetaLead(leadgenId, cfg, fetchFn = fetch) {
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(leadgenId)}?access_token=${encodeURIComponent(cfg.accessToken)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Meta ${res.status}: ${await res.text()}`);
  return res.json();
}
