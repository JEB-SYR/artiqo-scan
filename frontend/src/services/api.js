const BASE = "/api";

export async function syncScans(scans) {
  const res = await fetch(`${BASE}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scans }),
  });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  return res.json();
}

export async function fetchScans(limit = 100, offset = 0) {
  const res = await fetch(`${BASE}/scans?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export async function deleteScan(id) {
  const res = await fetch(`${BASE}/scans/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  return res.json();
}
