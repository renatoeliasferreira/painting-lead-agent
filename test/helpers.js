import { loadConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';

export function harness({ at = '2026-11-04T23:40:00Z', env = {}, slots } = {}) {
  const config = loadConfig({
    COMPANY_NAME: 'Brightside Painting',
    CLIENT_TIMEZONE: 'America/New_York',
    CLIENT_STATE: 'GA',
    SERVICE_ZIPS: '30301,30302',
    ...env,
  });
  const world = {
    now: new Date(at),
    calls: [],
    texts: [],
    alerts: [],
    bookings: [],
    slots: slots ?? ['2026-11-06T14:00:00.000Z', '2026-11-06T18:00:00.000Z', '2026-11-07T15:00:00.000Z', '2026-11-09T15:00:00.000Z'],
    failCallStart: false,
    failBooking: false,
  };
  const store = new Store();
  const engine = new Engine({
    config,
    store,
    clock: () => new Date(world.now),
    notify: async (t) => { world.alerts.push(t); },
    sms: { send: async (m) => { world.texts.push(m); } },
    voice: {
      placeCall: async (c) => {
        if (world.failCallStart) throw new Error('voice provider down');
        world.calls.push({ ...c, at: new Date(world.now) });
        return { id: `call_${world.calls.length}` };
      },
    },
    calendar: {
      getSlots: async () => world.slots,
      book: async (b) => {
        if (world.failBooking) throw new Error('slot taken');
        world.bookings.push(b);
        return { id: 1, uid: 'bk_1' };
      },
    },
  });
  const advance = async (minutes) => {
    world.now = new Date(world.now.getTime() + minutes * 60000);
    await engine.tick();
  };
  return { config, store, engine, world, advance };
}

export const lead = (over = {}) => ({
  source: 'website',
  externalId: 'sub_1',
  formId: 'website',
  name: 'Dana Reed',
  firstName: 'Dana',
  phone: '+14045550123',
  rawPhone: '404-555-0123',
  email: 'dana@example.com',
  zip: '30301',
  address: '',
  jobHint: 'interior repaint',
  consent: true,
  ...over,
});

export const qual = {
  job_type: 'interior', property_type: 'house', scope: '3 bedrooms', timeline: 'next month', zip: '30301',
};
