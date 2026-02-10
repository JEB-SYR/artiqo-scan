# artiqo scan - Technische Dokumentation

## Übersicht

Mobile Progressive Web App (PWA) zum Scannen von QR-Codes, Barcodes und DataMatrix-Codes mit Offline-Support. Scans werden lokal in IndexedDB gespeichert und bei Verbindung automatisch mit dem Server synchronisiert. Bei GPS-Koordinaten werden PLZ und Ort per Reverse Geocoding ergänzt.

- **URL:** https://artiqo.deusnet.de
- **GitHub:** https://github.com/JEB-SYR/artiqo-scan (privat)
- **Server:** 188.245.220.181
- **Zeitzone:** Europe/Berlin (CET/CEST)
- **Projektverzeichnis:** `/home/jeb/artiqo-scan/`

---

## Architektur

```
iPhone/Android (PWA)                     Server
┌──────────────────┐    HTTPS/REST    ┌─────────────────────┐
│ getUserMedia      │                  │ Caddy :443          │
│ ↓ Kamera-Stream  │                  │ ↓                   │
│ BarcodeDetector  │                  │ FastAPI :8001       │
│ + html5-qrcode   │                  │ ↓                   │
│ ↓ Scan           │                  │ MariaDB             │
│ GS1-Parser       │                  │ (artiqo_scan)       │
│ ↓                │                  │ ↓                   │
│ IndexedDB        │ ──POST /api/sync──→ INSERT + Reverse  │
│ (synced=0→1)     │                  │   Geocoding (OSM)   │
│ GPS, Timestamp   │                  │ ↓                   │
│ Service Worker   │  ←── Response ── │ PLZ + Ort ergänzt   │
└──────────────────┘                  └─────────────────────┘
```

### Technologie-Stack

| Komponente | Technologie | Version |
|------------|-------------|---------|
| Frontend | React + Vite | React 18.3, Vite 6.3 |
| PWA | vite-plugin-pwa (Workbox) | 0.21.2 |
| Scanner | html5-qrcode + native BarcodeDetector | 2.3.8 |
| Offline-DB | Dexie.js (IndexedDB) | 4.0 |
| Backend | FastAPI (Python) | 0.115.0 |
| DB-Treiber | aiomysql | 0.2.0 |
| HTTP-Client | httpx (Reverse Geocoding) | 0.28.1 |
| Datenbank | MariaDB | 11.8.3 |
| Webserver | Caddy (Let's Encrypt) | - |
| Geocoding | Nominatim / OpenStreetMap | - |

---

## Projektstruktur

```
/home/jeb/artiqo-scan/
├── backend/
│   ├── main.py              # FastAPI App + API-Endpoints + Reverse Geocoding
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
│   │   ├── logo-artiqo.png  # Header-Logo
│   │   └── test-barcodes.html  # Test-Barcodes zum Scannen
│   └── src/
│       ├── main.jsx         # Entry-Point
│       ├── App.jsx          # Tab-Navigation (Scan/Historie/Einstellungen)
│       ├── App.css          # Styling (Artiqo-Branding)
│       ├── components/
│       │   ├── Scanner.jsx      # Kamera-Scanner + GS1-Parser + Korrekturfelder
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
├── alter_db_geo.sql            # Migration: PLZ + Ort
├── DOKUMENTATION.md            # Diese Datei
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

Batch-Upload von Scans. Duplikate werden per UUID ignoriert (INSERT IGNORE). Bei vorhandenen GPS-Koordinaten wird automatisch Reverse Geocoding (Nominatim/OSM) durchgeführt und PLZ + Ort in der DB ergänzt.

**Request Body:**
```json
{
  "scans": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "content": "(01)04260436071104(10)LOT123(17)260315(21)SN999",
      "code_type": "GS1_DataMatrix",
      "scanned_at": "2026-02-10T16:35:24",
      "device_name": "iPhone",
      "latitude": 51.5765,
      "longitude": 6.7758
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
- `plz` — per Reverse Geocoding aus Koordinaten
- `ort` — per Reverse Geocoding aus Koordinaten

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
    "content": "(01)04260436071104(10)LOT123(17)260315(21)SN999",
    "code_type": "GS1_DataMatrix",
    "scanned_at": "2026-02-10T16:35:24",
    "device_name": "iPhone",
    "latitude": 51.5765,
    "longitude": 6.7758,
    "plz": "46539",
    "ort": "Dinslaken",
    "ip_address": "203.0.113.42",
    "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 ...)",
    "created_at": "2026-02-10T16:35:24"
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
| `content` | TEXT | NOT NULL | Gescannter Inhalt (GS1-Format mit AIs) |
| `code_type` | VARCHAR(50) | NOT NULL | GS1_128, GS1_DataMatrix, EAN_13, CODE_128, DATA_MATRIX |
| `scanned_at` | DATETIME | NOT NULL | Zeitpunkt des Scans (Client, lokale Zeit) |
| `device_name` | VARCHAR(100) | NULL | Automatisch erkannt (iPhone, Android, etc.) |
| `latitude` | DOUBLE | NULL | GPS-Breitengrad |
| `longitude` | DOUBLE | NULL | GPS-Längengrad |
| `plz` | VARCHAR(10) | NULL | Postleitzahl (Reverse Geocoding) |
| `ort` | VARCHAR(100) | NULL | Ortsname (Reverse Geocoding) |
| `ip_address` | VARCHAR(45) | NULL | Client-IP (IPv4/IPv6) |
| `user_agent` | TEXT | NULL | Browser + OS + Gerätetyp |
| `created_at` | DATETIME | DEFAULT NOW() | Server-Zeitstempel (MEZ) |

**Indizes:**
- `idx_scanned_at` auf `scanned_at`
- `idx_code_type` auf `code_type`

---

## Frontend (PWA)

### Unterstützte Scan-Formate

- **CODE-128** (inkl. GS1-128) — 1D-Barcode
- **DataMatrix** (inkl. GS1 DataMatrix) — 2D-Code
- **EAN-13** — Standard-Produktbarcode

### GS1-Parser

Erkennt Application Identifiers (AIs) in beliebiger Reihenfolge:

| AI | Feld | Länge | Beschreibung |
|----|------|-------|--------------|
| (01) | GTIN | 14 Ziffern | Global Trade Item Number |
| (10) | LOT | variabel | Chargen-/Losnummer |
| (17) | Verfall | 6 Ziffern (JJMMTT) | Verfallsdatum |
| (11) | Herstellung | 6 Ziffern (JJMMTT) | Herstelldatum |
| (21) | Seriennummer | variabel | Seriennummer |

**Code-128 typisch:** `(01)GTIN(17)Verfall(10)LOT`
**DataMatrix typisch:** `(01)GTIN(10)LOT(17)Verfall(21)Seriennummer`

Der Parser normalisiert Rohdaten mit GS-Separatoren (ASCII 29), Symbologie-Prefixen (`]C1`, `]d2`) und Scanner-Artefakten (Noise-Zeichen) automatisch ins Klammern-Format.

### Scan-Ablauf

1. **Kamera-Stream** via `getUserMedia` (Rückkamera, 1920x1080)
2. **Kontinuierliches Scannen** alle 600ms:
   - Schritt 1: Dünner Streifen aus der Mitte (~8% Höhe) für 1D-Barcodes
   - Schritt 2: Quadratischer Ausschnitt (60%) für DataMatrix
   - Jeweils: Otsu-Binarisierung → native BarcodeDetector → html5-qrcode Fallback
3. **Scan-Ergebnis** → GS1-Parser → Korrekturfelder (nur befüllte Felder)
4. **Speichern** oder **Verwerfen** → direkt weiter zum nächsten Scan
5. **Sync** → IndexedDB → Server (mit Reverse Geocoding)

### Scan-Feedback

1. **Piepton** — 1200 Hz Sinuston (120ms) via Web Audio API
2. **Vibration** — 100ms Haptic Feedback
3. **Korrekturfelder** — GS1-Felder einzeln editierbar (nur befüllte angezeigt)
4. **Speichern** (grün) / **Verwerfen** (rot) — Buttons unter der Ergebnisbox
5. **Uhrzeit** — Anzeige in hh:mm:ss

### Scan-Overlay

- **Rote Scan-Linie** (horizontal) — Positionierungshilfe für 1D-Barcodes
- **Gestricheltes Quadrat** (weiß) — Positionierungshilfe für DataMatrix
- **Dunkle Bereiche** oben/unten — visueller Fokus auf Scan-Bereich
- **Taschenlampe** — Button oben rechts (falls verfügbar)

### Geräte-Erkennung

Der Gerätename wird automatisch aus dem User-Agent erkannt:
- iPhone, iPad, Android (mit Modellname), Mac, Windows
- Kann in den Einstellungen manuell überschrieben werden

### Offline-Funktionalität

**IndexedDB (Dexie.js):**
- Tabelle `scans`: Lokaler Speicher mit `synced`-Flag (0=ungesynct, 1=gesynct)
- Tabelle `settings`: Gerätename, letzte Sync-Zeit

**Sync-Strategie:**
- Bei App-Start: Auto-Sync
- Bei `online`-Event: Auto-Sync
- Nach jedem Scan (wenn online): Sofort-Sync
- Manueller "Sync"-Button mit Badge (Anzahl ungesyncte Scans)

### iOS/Android-Optimierungen

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
nohup /home/jeb/artiqo-scan/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001 --app-dir /home/jeb/artiqo-scan/backend > /tmp/artiqo-backend.log 2>&1 &
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

### 1. Zeitzone setzen

```bash
sudo timedatectl set-timezone Europe/Berlin
```

### 2. Datenbank anlegen

```bash
sudo mysql < /home/jeb/artiqo-scan/setup_db.sql
sudo mysql < /home/jeb/artiqo-scan/alter_db.sql
sudo mysql artiqo_scan < /home/jeb/artiqo-scan/alter_db_geo.sql
```

### 3. Backend-Dependencies

```bash
cd /home/jeb/artiqo-scan/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 4. Frontend-Dependencies + Build

```bash
cd /home/jeb/artiqo-scan/frontend
npm install
npm run build
```

### 5. Caddy-Site aktivieren

```bash
sudo cp /home/jeb/artiqo-scan/artiqo.deusnet.de.caddy /etc/caddy/sites/
sudo caddy reload --config /etc/caddy/Caddyfile
```

### 6. Home-Verzeichnis für Caddy zugänglich machen

```bash
sudo chmod o+x /home/jeb
```

### 7. Backend starten

```bash
nohup /home/jeb/artiqo-scan/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001 --app-dir /home/jeb/artiqo-scan/backend > /tmp/artiqo-backend.log 2>&1 &
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

# Test-Barcodes (im Browser öffnen)
# https://artiqo.deusnet.de/test-barcodes.html
```

### Geräte-Test

1. Safari/Chrome → `https://artiqo.deusnet.de`
2. Teilen-Button → "Zum Home-Bildschirm"
3. App öffnen → Standalone-Modus (keine Browser-UI)
4. Barcode scannen → Korrekturfelder mit GS1-Daten
5. DataMatrix scannen → GTIN, LOT, Verfall, Seriennummer
6. Prüfen + Speichern → direkt nächster Scan
7. Flugmodus an → weiter scannen → Scans lokal gespeichert
8. Flugmodus aus → Auto-Sync → Scans in MariaDB mit PLZ + Ort prüfen
