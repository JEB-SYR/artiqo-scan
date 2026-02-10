import { useState, useEffect, useCallback } from "react";
import { syncUnsynced, getUnsyncedCount } from "../services/syncService";

export default function SyncStatus({ online, refreshKey, onSyncDone }) {
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const updateCount = useCallback(async () => {
    setCount(await getUnsyncedCount());
  }, []);

  useEffect(() => {
    updateCount();
  }, [updateCount, refreshKey]);

  const handleSync = async () => {
    if (syncing || !online) return;
    setSyncing(true);
    try {
      await syncUnsynced();
      await updateCount();
      onSyncDone?.();
    } catch {
      // Sync failed, will retry
    } finally {
      setSyncing(false);
    }
  };

  // Auto-sync on online event
  useEffect(() => {
    if (online && count > 0) {
      handleSync();
    }
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sync-status">
      <div className={`online-indicator ${online ? "online" : "offline"}`}>
        {online ? "Online" : "Offline"}
      </div>
      <button
        className="sync-button"
        onClick={handleSync}
        disabled={syncing || !online || count === 0}
      >
        {syncing ? "Synce..." : "Sync"}
        {count > 0 && <span className="sync-badge">{count}</span>}
      </button>
    </div>
  );
}
