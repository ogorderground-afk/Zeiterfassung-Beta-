import { db, setSetting } from '../db';

export async function migrateFromLocalStorage() {
  const row = await db.settings.get('_migrated');
  if (row) return false;

  const parse = (key, def) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
    catch { return def; }
  };

  const workSessions  = parse('workSessions',  []);
  const driveSessions = parse('driveSessions', []);
  const notes         = parse('notes',         []);
  const actionLog     = parse('actionLog',     []);
  const gpsLog        = parse('gpsLog',        []);

  if (workSessions.length)  await db.workSessions.bulkPut(workSessions);
  if (driveSessions.length) await db.driveSessions.bulkPut(driveSessions);
  if (notes.length)         await db.notes.bulkPut(notes);
  if (actionLog.length)     await db.actionLog.bulkAdd(actionLog.map(({ id, ...rest }) => rest));
  if (gpsLog.length)        await db.gpsLog.bulkAdd(gpsLog.map(({ id, ...rest }) => rest));

  const settingKeys = ['gpsInterval','rules','notificationEnabled','driveExpanded','triggeredRules','work','drive'];
  for (const key of settingKeys) {
    const v = parse(key, undefined);
    if (v !== undefined) await setSetting(key, v);
  }

  await setSetting('_migrated', Date.now());
  return true;
}
