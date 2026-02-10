import { db } from "../db/dexie";
import { syncScans } from "./api";

export async function syncUnsynced() {
  const unsynced = await db.scans.where("synced").equals(0).toArray();
  if (unsynced.length === 0) return 0;

  const payload = unsynced.map((s) => ({
    id: s.id,
    content: s.content,
    code_type: s.code_type,
    scanned_at: s.scanned_at,
    device_name: s.device_name,
    latitude: s.latitude,
    longitude: s.longitude,
  }));

  await syncScans(payload);

  await db.scans
    .where("id")
    .anyOf(unsynced.map((s) => s.id))
    .modify({ synced: 1 });

  return unsynced.length;
}

export async function getUnsyncedCount() {
  return db.scans.where("synced").equals(0).count();
}
