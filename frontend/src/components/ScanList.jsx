import { useState, useEffect, useCallback } from "react";
import { db } from "../db/dexie";

export default function ScanList({ refreshKey }) {
  const [scans, setScans] = useState([]);

  const loadScans = useCallback(async () => {
    const all = await db.scans.orderBy("scanned_at").reverse().limit(200).toArray();
    setScans(all);
  }, []);

  useEffect(() => {
    loadScans();
  }, [loadScans, refreshKey]);

  const handleDelete = async (id) => {
    await db.scans.delete(id);
    loadScans();
  };

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (scans.length === 0) {
    return <div className="empty-list">Noch keine Scans vorhanden</div>;
  }

  return (
    <div className="scan-list">
      {scans.map((scan) => (
        <div key={scan.id} className="scan-item">
          <div className="scan-item-main">
            <div className="scan-item-content">{scan.content}</div>
            <div className="scan-item-meta">
              <span className="scan-item-type">{scan.code_type}</span>
              <span className="scan-item-date">{formatDate(scan.scanned_at)}</span>
              <span className={`scan-item-sync ${scan.synced ? "synced" : "unsynced"}`}>
                {scan.synced ? "\u2713" : "\u25cf"}
              </span>
            </div>
          </div>
          <button className="scan-item-delete" onClick={() => handleDelete(scan.id)} aria-label="Löschen">
            \u2715
          </button>
        </div>
      ))}
    </div>
  );
}
