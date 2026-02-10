import { useState, useCallback, useEffect } from "react";
import Scanner from "./components/Scanner";
import ScanList from "./components/ScanList";
import SyncStatus from "./components/SyncStatus";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { getSetting, setSetting } from "./db/dexie";
import { syncUnsynced } from "./services/syncService";

const TABS = {
  SCAN: "scan",
  HISTORY: "history",
  SETTINGS: "settings",
};

export default function App() {
  const [tab, setTab] = useState(TABS.SCAN);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deviceName, setDeviceName] = useState("");
  const online = useOnlineStatus();

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Load settings
  useEffect(() => {
    getSetting("device_name").then((name) => {
      if (name) setDeviceName(name);
    });
  }, []);

  // Auto-sync on app start
  useEffect(() => {
    if (online) {
      syncUnsynced().then(triggerRefresh).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDeviceName = async () => {
    await setSetting("device_name", deviceName);
  };

  return (
    <div className="app">
      <header className="app-header">
        <img src="/logo-artiqo.png" alt="artiqo" className="app-logo" />
        <SyncStatus
          online={online}
          refreshKey={refreshKey}
          onSyncDone={triggerRefresh}
        />
      </header>

      <main className="app-content">
        {tab === TABS.SCAN && (
          <Scanner online={online} onScanComplete={triggerRefresh} />
        )}
        {tab === TABS.HISTORY && <ScanList refreshKey={refreshKey} />}
        {tab === TABS.SETTINGS && (
          <div className="settings">
            <div className="settings-group">
              <label className="settings-label">Gerätename</label>
              <div className="settings-input-row">
                <input
                  type="text"
                  className="settings-input"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="z.B. iPhone 17"
                />
                <button className="settings-save" onClick={saveDeviceName}>
                  Speichern
                </button>
              </div>
            </div>
            <div className="settings-info">
              <p>Version 1.0.0</p>
              <p>Scans werden lokal gespeichert und bei Verbindung synchronisiert.</p>
            </div>
          </div>
        )}
      </main>

      <nav className="tab-bar">
        <button
          className={`tab ${tab === TABS.SCAN ? "active" : ""}`}
          onClick={() => setTab(TABS.SCAN)}
        >
          <svg viewBox="0 0 24 24" className="tab-icon">
            <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm13-2h-2v3h-3v2h3v3h2v-3h3v-2h-3v-3z" />
          </svg>
          <span>Scan</span>
        </button>
        <button
          className={`tab ${tab === TABS.HISTORY ? "active" : ""}`}
          onClick={() => setTab(TABS.HISTORY)}
        >
          <svg viewBox="0 0 24 24" className="tab-icon">
            <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
          </svg>
          <span>Historie</span>
        </button>
        <button
          className={`tab ${tab === TABS.SETTINGS ? "active" : ""}`}
          onClick={() => setTab(TABS.SETTINGS)}
        >
          <svg viewBox="0 0 24 24" className="tab-icon">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
          </svg>
          <span>Einst.</span>
        </button>
      </nav>
    </div>
  );
}
