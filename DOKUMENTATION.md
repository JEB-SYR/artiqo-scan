# artiqo scan - Technische Dokumentation

## Übersicht

Mobile Progressive Web App (PWA) zum Scannen von QR-Codes und Barcodes mit Offline-Support. Scans werden lokal in IndexedDB gespeichert und bei Verbindung automatisch mit dem Server synchronisiert.

- **URL:** https://artiqo.deusnet.de
- **Server:** 188.245.220.181
- **Projektverzeichnis:** `/home/jeb/artiqo-scan/`

---

## Architektur

```
iPhone (PWA)                              Server
┌──────────────────┐    HTTPS/REST    ┌─────────────────┐
│ html5-qrcode     │                  │ Caddy :443      │
│ ↓ Scan           │                  │ ↓               │
│ IndexedDB        │ ──POST /api/sync──→ FastAPI :8001  │
│ (synced=0→1)     │                  │ ↓               │
│ GPS, Timestamp   │                  │ MariaDB         │
│ Service Worker   │  ←── Response ── │ (artiqo_scan)   │
└──────────────────┘                  └─────────────────┘
```

### Technologie-Stack

| Komponente | Technologie | Version |
|------------|-------------|---------|
| Frontend | React + Vite | React 18.3, Vite 6.3 |
| PWA | vite-plugin-pwa (Workbox) | 0.21.2 |
| Scanner | html5-qrcode | 2.3.8 |
| Offline-DB | Dexie.js (IndexedDB) | 4.0 |
| Backend | FastAPI (Python) | 0.115.0 |
| DB-Treiber | aiomysql | 0.2.0 |
| Datenbank | MariaDB | 11.8.3 |
| Webserver | Caddy (Let's Encrypt) | - |

---

## Projektstruktur

```
/home/jeb/artiqo-scan/
├── backend/
│   ├── main.py              # FastAPI App + API-Endpoints
│   ├── database.py          # Async MariaDB Connection-Pool
│   ├── models.py            # Pydantic-Models
│   ├── requirements.txt     # Python-Dependencies
│   ├── venv/                # Python Virtual Environment
│   └── .env                 # DB-Credentials (nicht in Git)
├── frontend/
│   ├── index.html           # iOS PWA Meta-Tags
│   ├── vite.config.js       # PWA-Plugin + Dev-Proxy
│   ├── package.json         # Node-Dependencies
│   ├── dist/                # Production-Build (Caddy served)
│   ├── public/
│   │   ├── icon-192.png     # PWA-Icon 192x192
│   │   ├── icon-512.png     # PWA-Icon 512x512
│   │   ├── apple-touch-icon.png
│   │   ├── favicon-artiqo.png
│   │   └── logo-artiqo.png  # Header-Logo
│   └── src/
│       ├── main.jsx         # Entry-Point
│       ├── App.jsx          # Tab-Navigation (Scan/Historie/Einstellungen)
│       ├── App.css          # Styling (Artiqo-Branding)
│       ├── components/
│       │   ├── Scanner.jsx      # Kamera-Scanner + Beep-Feedback
│       │   ├── ScanList.jsx     # Scan-Historie
│       │   └── SyncStatus.jsx   # Online/Offline + Sync-Button
│       ├── db/
│       │   └── dexie.js         # IndexedDB Schema
│       ├── hooks/
│       │   ├── useOnlineStatus.js   # Online/Offline-Detection
│       │   └── useGeolocation.js    # GPS-Koordinaten
│       └── services/
│           ├── syncService.js   # IndexedDB → Server Sync
│           └── api.js           # Fetch-Wrapper für API
├── artiqo.deusnet.de.caddy     # Caddy-Site-Config
├── setup_db.sql                # Initiales DB-Setup
├── alter_db.sql                # Migration: IP + User-Agent
└── .gitignore
```

---

## API-Endpoints

Basis-URL: `https://artiqo.deusnet.de/api`

### GET /api/health

Health-Check mit DB-Verbindungstest.

**Response:**
```json
{"status": "ok"}
```

### POST /api/sync

Batch-Upload von Scans. Duplikate werden per UUID ignoriert (INSERT IGNORE).

**Request Body:**
```json
{
  "scans": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "content": "4048413701455",
      "code_type": "EAN_13",
      "scanned_at": "2026-02-10T10:35:24",
      "device_name": "iPhone 17",
      "latitude": 51.1657,
      "longitude": 10.4515
    }
  ]
}
```

**Response:**
```json
{"synced": 1, "message": "1 scans synced"}
```

**Serverseitig erfasst (nicht im Request):**
- `ip_address` — aus `X-Forwarded-For` Header (Caddy) oder Client-IP
- `user_agent` — aus `User-Agent` Header

### GET /api/scans

Alle Scans paginiert abrufen.

| Parameter | Typ | Default | Bereich |
|-----------|-----|---------|---------|
| `limit` | int | 100 | 1–1000 |
| `offset` | int | 0 | ≥ 0 |

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "content": "4048413701455",
    "code_type": "EAN_13",
    "scanned_at": "2026-02-10T10:35:24",
    "device_name": "iPhone 17",
    "latitude": 51.1657,
    "longitude": 10.4515,
    "ip_address": "203.0.113.42",
    "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 ...)",
    "created_at": "2026-02-10T10:35:24"
  }
]
```

### DELETE /api/scans/{scan_id}

Einzelnen Scan löschen.

**Response:** `{"deleted": "scan_id"}` oder HTTP 404.

---

## Datenbank

### Verbindung

| Parameter | Wert |
|-----------|------|
| Host | localhost |
| Port | 3306 |
| Datenbank | `artiqo_scan` |
| User | `artiqo` |
| Charset | utf8mb4 |
| Connection-Pool | 2–10 Verbindungen |

### Tabelle: scans

| Spalte | Typ | Constraints | Beschreibung |
|--------|-----|-------------|--------------|
| `id` | CHAR(36) | PRIMARY KEY | UUID vom Client |
| `content` | TEXT | NOT NULL | Gescannter Inhalt |
| `code_type` | VARCHAR(50) | NOT NULL | QR_CODE, EAN_13, EAN_8, CODE_128, CODE_39, UPC_A |
| `scanned_at` | DATETIME | NOT NULL | Zeitpunkt des Scans (Client) |
| `device_name` | VARCHAR(100) | NULL | Vom User konfigurierter Gerätename |
| `latitude` | DOUBLE | NULL | GPS-Breitengrad |
| `longitude` | DOUBLE | NULL | GPS-Längengrad |
| `ip_address` | VARCHAR(45) | NULL | Client-IP (IPv4/IPv6) |
| `user_agent` | TEXT | NULL | Browser + OS + Gerätetyp |
| `created_at` | DATETIME | DEFAULT NOW() | Server-Zeitstempel |

**Indizes:**
- `idx_scanned_at` auf `scanned_at`
- `idx_code_type` auf `code_type`

---

## Frontend (PWA)

### Unterstützte Scan-Formate

- QR-Code
- EAN-13
- EAN-8
- CODE-128
- CODE-39
- UPC-A

### Scan-Feedback

1. **Piepton** — 1200 Hz Sinuston (120ms) via Web Audio API
2. **Vibration** — 100ms Haptic Feedback
3. **Grünes Fenster** — Scan-Ergebnis wird grün hinterlegt angezeigt
4. **"Nächster Scan" Button** — setzt das Ergebnis-Fenster zurück
5. **Uhrzeit** — Anzeige in hh:mm:ss

### Offline-Funktionalität

**IndexedDB (Dexie.js):**
- Tabelle `scans`: Lokaler Speicher mit `synced`-Flag (0=ungesynct, 1=gesynct)
- Tabelle `settings`: Gerätename, letzte Sync-Zeit

**Sync-Strategie:**
- Bei App-Start: Auto-Sync
- Bei `online`-Event: Auto-Sync
- Nach jedem Scan (wenn online): Sofort-Sync
- Manueller "Sync"-Button mit Badge (Anzahl ungesyncte Scans)

### iOS-Optimierungen

- `apple-mobile-web-app-capable: yes` — Standalone-Modus
- `viewport-fit: cover` + `env(safe-area-inset-*)` — Notch/Dynamic Island
- `overscroll-behavior-y: contain` — kein Pull-to-Refresh
- Service Worker mit `registerType: autoUpdate`
- Kamera-Neustart bei `visibilitychange` (iOS suspendiert Kamera bei App-Wechsel)
- Alle statischen Assets precached für Offline-Start

### Branding

- **Farben:** Artiqo-Rot (#c30a2a), Weiß, Hellgrau (#f4f4f4)
- **Logo:** artiqo-Logo im Header (von artiqo.de)
- **Theme-Color:** #c30a2a (Statusleiste auf iOS/Android)

---

## Caddy-Konfiguration

Datei: `/etc/caddy/sites/artiqo.deusnet.de.caddy`

```
artiqo.deusnet.de {
    /api/*    → reverse_proxy localhost:8001
    /*        → file_server aus frontend/dist/ + SPA-Fallback
}
```

**Cache-Strategie:**
- Statische Assets (JS, CSS, Fonts, Bilder): `immutable, max-age=1 Jahr`
- HTML, Service Worker, Manifest: `no-cache`
- SSL: Automatisch via Let's Encrypt

---

## Betrieb

### Backend starten

```bash
cd /home/jeb/artiqo-scan/backend
nohup ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001 > /tmp/artiqo-backend.log 2>&1 &
```

### Backend stoppen

```bash
kill $(pgrep -f 'uvicorn main:app.*8001')
```

### Frontend neu bauen

```bash
cd /home/jeb/artiqo-scan/frontend
npm run build
```

Caddy liefert automatisch die neuen Dateien aus `dist/` aus — kein Reload nötig.

### Caddy neu laden (nach Config-Änderung)

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

### Backend-Log prüfen

```bash
tail -f /tmp/artiqo-backend.log
```

### Laufende Prozesse prüfen

```bash
# Backend
ss -tlnp | grep 8001

# Caddy
ss -tlnp | grep -E '(80|443)'
```

---

## Ersteinrichtung (auf neuem Server)

### 1. Datenbank anlegen

```bash
sudo mysql < /home/jeb/artiqo-scan/setup_db.sql
sudo mysql < /home/jeb/artiqo-scan/alter_db.sql
```

### 2. Backend-Dependencies

```bash
cd /home/jeb/artiqo-scan/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Frontend-Dependencies + Build

```bash
cd /home/jeb/artiqo-scan/frontend
npm install
npm run build
```

### 4. Caddy-Site aktivieren

```bash
sudo cp /home/jeb/artiqo-scan/artiqo.deusnet.de.caddy /etc/caddy/sites/
sudo caddy reload --config /etc/caddy/Caddyfile
```

### 5. Home-Verzeichnis für Caddy zugänglich machen

```bash
sudo chmod o+x /home/jeb
```

### 6. Backend starten

```bash
cd /home/jeb/artiqo-scan/backend
nohup ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001 > /tmp/artiqo-backend.log 2>&1 &
```

---

## Verifikation

```bash
# API Health-Check
curl https://artiqo.deusnet.de/api/health
# → {"status": "ok"}

# Frontend erreichbar
curl -s -o /dev/null -w "%{http_code}" https://artiqo.deusnet.de/
# → 200

# PWA-Manifest
curl https://artiqo.deusnet.de/manifest.webmanifest
# → JSON mit name, icons, theme_color

# Service Worker
curl -s -o /dev/null -w "%{http_code}" https://artiqo.deusnet.de/sw.js
# → 200
```

### iPhone-Test

1. Safari → `https://artiqo.deusnet.de`
2. Teilen-Button → "Zum Home-Bildschirm"
3. App öffnen → Standalone-Modus (keine Browser-UI)
4. QR-Code scannen → Piepton + grünes Fenster
5. Flugmodus an → weiter scannen → Scans lokal gespeichert
6. Flugmodus aus → Auto-Sync → Scans in MariaDB prüfen
