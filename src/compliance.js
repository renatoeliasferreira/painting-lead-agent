// Decides whether a call may go out right now. Starter values, not legal advice.
// The window is checked in code so a prompt or workflow change cannot bypass it.

const DEFAULT_WINDOW = { startHour: 8, endHour: 21 };
const STATE_WINDOWS = {
  FL: { startHour: 8, endHour: 20 },
  CT: { startHour: 9, endHour: 20 },
};

export function windowFor(state) {
  return STATE_WINDOWS[state] || DEFAULT_WINDOW;
}

function localHour(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour').value);
}

export function inCallWindow(date, { timeZone, state }) {
  const { startHour, endHour } = windowFor(state);
  const hour = localHour(date, timeZone);
  return hour >= startHour && hour < endHour;
}

// Walks forward minute by minute so daylight saving changes need no special case.
export function nextWindowOpen(date, cfg) {
  const t = new Date(date);
  t.setUTCSeconds(0, 0);
  for (let i = 0; i < 60 * 48; i += 1) {
    if (inCallWindow(t, cfg)) return t;
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  throw new Error('No call window found in the next 48 hours');
}

export function earliestCallTime(now, config) {
  if (!config.enforceCallWindow) return now;
  const cfg = { timeZone: config.timeZone, state: config.state };
  return inCallWindow(now, cfg) ? now : nextWindowOpen(now, cfg);
}
