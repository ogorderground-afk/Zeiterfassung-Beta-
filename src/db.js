import Dexie from 'dexie';

export const db = new Dexie('ZeitTracker');
db.version(1).stores({
  workSessions:  'start',
  driveSessions: 'start',
  notes:         'id, ts',
  actionLog:     '++id, ts',
  gpsLog:        '++id, ts',
  settings:      'key',
});

export async function getSetting(key, def = null) {
  const row = await db.settings.get(key);
  return row !== undefined ? row.value : def;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}
