import Dexie from "dexie";

export const db = new Dexie("artiqo-scan");

db.version(1).stores({
  scans: "id, scanned_at, synced, code_type",
  settings: "key",
});

export async function getSetting(key) {
  const row = await db.settings.get(key);
  return row?.value ?? null;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}
