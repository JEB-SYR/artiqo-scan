import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db/dexie";
import { getPosition } from "../hooks/useGeolocation";
import { getSetting } from "../db/dexie";
import { syncUnsynced } from "../services/syncService";

// ── GS1 Parser (Code-128 + DataMatrix) ────────────────────────
// Erkennt AIs in beliebiger Reihenfolge:
//   (01) GTIN         - 14 Ziffern
//   (10) LOT/Charge   - variabel (alphanumerisch)
//   (17) Verfall      - 6 Ziffern (JJMMTT)
//   (11) Herstellung  - 6 Ziffern (JJMMTT)
//   (21) Seriennummer - variabel (alphanumerisch)

// GS1 String normalisieren: GS-Separatoren (\x1d) durch Klammern ersetzen
function normalizeGS1(raw) {
  let data = raw;
  // Symbologie-Prefix entfernen (]C1 = Code-128, ]d2 = DataMatrix)
  if (/^\](?:C1|c1|d2|D2|e0|E0)/.test(data)) data = data.slice(3);
  // Bereits mit Klammern formatiert? Direkt zurückgeben
  if (/\(01\)/.test(data)) return data;
  // GS-Separatoren (\x1d) und andere Steuerzeichen als AI-Trenner nutzen
  // Bekannte feste AIs nach GTIN einsetzen
  const aiDefs = [
    { code: "01", len: 14 },
    { code: "02", len: 14 },
    { code: "10", len: 0 },  // variabel
    { code: "11", len: 6 },
    { code: "17", len: 6 },
    { code: "21", len: 0 },  // variabel
  ];
  // Steuerzeichen + Noise entfernen, aber Position merken
  // Strategie: AIs der Reihe nach aus dem String parsen
  let result = "";
  let pos = 0;
  const clean = data.replace(/[\x00-\x1f]/g, "\x1d"); // alle Control-Chars zu GS
  while (pos < clean.length) {
    let matched = false;
    for (const ai of aiDefs) {
      if (clean.substring(pos, pos + ai.code.length) === ai.code) {
        const valueStart = pos + ai.code.length;
        let valueEnd;
        if (ai.len > 0) {
          // Feste Länge
          valueEnd = valueStart + ai.len;
          const val = clean.substring(valueStart, valueEnd).replace(/[^\d]/g, "");
          result += "(" + ai.code + ")" + val;
        } else {
          // Variable Länge: bis GS-Separator oder nächster AI oder Ende
          valueEnd = valueStart;
          while (valueEnd < clean.length && clean[valueEnd] !== "\x1d") valueEnd++;
          const val = clean.substring(valueStart, valueEnd).replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9\-_.]/g, "");
          if (val) result += "(" + ai.code + ")" + val;
        }
        pos = valueEnd;
        // GS-Separator überspringen
        if (pos < clean.length && clean[pos] === "\x1d") pos++;
        matched = true;
        break;
      }
    }
    if (!matched) pos++; // Unbekanntes Zeichen überspringen
  }
  return result || null;
}

function extractGS1Fields(content) {
  const gtinM = /\(01\)\s*(\d{10,14})/.exec(content);
  if (!gtinM) return null;
  const gtin = gtinM[1];
  const lotM = /\(10\)\s*([^(]+)/.exec(content);
  const lot = lotM ? lotM[1].trim() : "";
  const expiryM = /\(17\)\s*(\d{4,6})/.exec(content);
  const expiry = expiryM ? expiryM[1] : "";
  const prodM = /\(11\)\s*(\d{4,6})/.exec(content);
  const prodDate = prodM ? prodM[1] : "";
  const serialM = /\(21\)\s*([^(]+)/.exec(content);
  const serial = serialM ? serialM[1].trim() : "";
  return { gtin, lot, expiry, prodDate, serial };
}

function tryParseGS1(raw) {
  // Bereits sauber formatiert?
  if (/\(01\)/.test(raw) && (/\(10\)/.test(raw) || /\(17\)/.test(raw) || /\(21\)/.test(raw))) {
    return raw;
  }
  // Raw-Daten normalisieren (Steuerzeichen → Klammern-Format)
  const normalized = normalizeGS1(raw);
  if (!normalized || !normalized.includes("(01)")) return null;
  return normalized;
}

// Bild zu Schwarzweiß (Otsu-Binarisierung)
function binarizeCanvas(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const bwCanvas = document.createElement("canvas");
  bwCanvas.width = w; bwCanvas.height = h;
  const ctx = bwCanvas.getContext("2d");
  ctx.drawImage(srcCanvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) {
    histogram[Math.round(d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114)]++;
  }
  const total = w * h;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t]; if (wB === 0) continue;
    const wF = total - wB; if (wF === 0) break;
    sumB += t * histogram[t];
    const between = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) ** 2;
    if (between > maxVar) { maxVar = between; threshold = t; }
  }
  for (let i = 0; i < d.length; i += 4) {
    const bw = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) > threshold ? 255 : 0;
    d[i] = bw; d[i+1] = bw; d[i+2] = bw;
  }
  ctx.putImageData(imageData, 0, 0);
  return bwCanvas;
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 1200; osc.type = "sine"; gain.gain.value = 0.3;
    osc.start(); osc.stop(ctx.currentTime + 0.12);
  } catch { /* */ }
}

function detectDevice() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) {
    const m = ua.match(/;\s*([^;)]+)\s*Build\//);
    return m ? m[1].trim() : "Android";
  }
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Unbekannt";
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Barcode aus Canvas erkennen
async function detectBarcode(canvas) {
  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector({ formats: ["code_128", "ean_13", "data_matrix"] });
      const results = await detector.detect(canvas);
      if (results.length > 0) return { text: results[0].rawValue, format: results[0].format || "UNKNOWN" };
    } catch { /* */ }
  }
  try {
    const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
    const file = new File([blob], "s.png", { type: "image/png" });
    let el = document.getElementById("qr-hidden");
    if (!el) { el = document.createElement("div"); el.id = "qr-hidden"; el.style.display = "none"; document.body.appendChild(el); }
    const qr = new Html5Qrcode("qr-hidden");
    const result = await qr.scanFileV2(file, false);
    const r = { text: result.decodedText, format: result.result?.format?.formatName || "UNKNOWN" };
    qr.clear();
    return r;
  } catch { return null; }
}

const SCAN_INTERVAL_MS = 600;
const SCAN_COOLDOWN_MS = 2500;

export default function Scanner({ online, onScanComplete }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const lastScanTimeRef = useRef(0);
  const scanningActiveRef = useRef(true);

  const [cameraReady, setCameraReady] = useState(false);
  const [pendingScan, setPendingScan] = useState(null);
  const [editGtin, setEditGtin] = useState("");
  const [editLot, setEditLot] = useState("");
  const [editExpiry, setEditExpiry] = useState("");
  const [editProdDate, setEditProdDate] = useState("");
  const [editSerial, setEditSerial] = useState("");
  const [editContent, setEditContent] = useState("");
  const [isGS1, setIsGS1] = useState(false);
  const [savedResult, setSavedResult] = useState(null);
  const [error, setError] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  // ── Scan-Ergebnis verarbeiten ──────────────────────────────
  const processResult = useCallback(async (decodedText, formatName) => {
    playBeep();
    if (navigator.vibrate) navigator.vibrate(100);

    const gs1Parsed = tryParseGS1(decodedText);
    const isDataMatrix = /data.?matrix/i.test(formatName);
    const codeType = gs1Parsed ? (isDataMatrix ? "GS1_DataMatrix" : "GS1_128") : formatName;
    const content = gs1Parsed || decodedText;
    const position = await getPosition();
    const savedName = await getSetting("device_name");
    const deviceName = savedName || detectDevice();
    const rawVisible = decodedText.replace(/[\x00-\x1f]/g, (ch) => `[${ch.charCodeAt(0)}]`);

    const scan = {
      id: uuidv4(), content,
      rawContent: rawVisible,
      code_type: codeType,
      scanned_at: new Date().toLocaleString("sv-SE", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).replace(" ", "T"),
      device_name: deviceName,
      latitude: position.latitude, longitude: position.longitude,
      synced: 0,
    };

    const fields = extractGS1Fields(content) || extractGS1Fields(decodedText);
    if (fields) {
      setIsGS1(true);
      setEditGtin(fields.gtin); setEditLot(fields.lot);
      setEditExpiry(fields.expiry); setEditProdDate(fields.prodDate);
      setEditSerial(fields.serial);
    } else {
      setIsGS1(false);
      setEditContent(content);
    }
    setPendingScan(scan);
    setSavedResult(null);
    scanningActiveRef.current = false; // Pause scanning
  }, []);

  // ── Kontinuierliches Scannen des Streifens ─────────────────
  useEffect(() => {
    if (!cameraReady) return;

    async function scanFrame() {
      if (!scanningActiveRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      if (Date.now() - lastScanTimeRef.current < SCAN_COOLDOWN_MS) return;

      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw === 0 || vh === 0) return;

      let result = null;

      // ── 1. Dünner Streifen für 1D-Barcodes (~8% Höhe) ──
      const stripH = Math.max(50, Math.floor(vh * 0.08));
      const stripY = Math.floor((vh - stripH) / 2);
      const strip = document.createElement("canvas");
      strip.width = vw; strip.height = stripH;
      strip.getContext("2d").drawImage(video, 0, stripY, vw, stripH, 0, 0, vw, stripH);

      const bwStrip = binarizeCanvas(strip);
      result = await detectBarcode(bwStrip);
      if (!result) result = await detectBarcode(strip);

      // ── 2. Quadrat aus der Mitte für DataMatrix ──
      if (!result) {
        const side = Math.min(vw, vh) * 0.6;
        const sx = Math.floor((vw - side) / 2);
        const sy = Math.floor((vh - side) / 2);
        const square = document.createElement("canvas");
        square.width = side; square.height = side;
        square.getContext("2d").drawImage(video, sx, sy, side, side, 0, 0, side, side);

        const bwSquare = binarizeCanvas(square);
        result = await detectBarcode(bwSquare);
        if (!result) result = await detectBarcode(square);
      }

      if (result) {
        lastScanTimeRef.current = Date.now();
        processResult(result.text, result.format);
      }
    }

    scanTimerRef.current = setInterval(scanFrame, SCAN_INTERVAL_MS);
    return () => clearInterval(scanTimerRef.current);
  }, [cameraReady, processResult]);

  // ── Kamera starten ──────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraReady(true); setError(null);
        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            const caps = track.getCapabilities?.();
            if (caps?.torch) setTorchAvailable(true);
          } catch { /* */ }
        }
      } catch (err) {
        if (mounted) setError("Kamera-Zugriff nicht möglich: " + err.message);
      }
    }

    function stopCamera() {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null; setCameraReady(false); setTorchOn(false);
    }

    startCamera();
    const handleVis = () => {
      if (document.visibilityState === "visible") { stopCamera(); startCamera(); }
      else stopCamera();
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => { mounted = false; document.removeEventListener("visibilitychange", handleVis); stopCamera(); };
  }, []);

  // ── Torch ──────────────────────────────────────────────────
  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { const s = !torchOn; await track.applyConstraints({ advanced: [{ torch: s }] }); setTorchOn(s); }
    catch { /* */ }
  }, [torchOn]);

  // ── Speichern ──────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!pendingScan) return;
    let content;
    if (isGS1) {
      content = "(01)" + editGtin;
      if (editLot) content += "(10)" + editLot;
      if (editExpiry) content += "(17)" + editExpiry;
      if (editProdDate) content += "(11)" + editProdDate;
      if (editSerial) content += "(21)" + editSerial;
    } else {
      content = editContent;
    }
    const scan = { ...pendingScan, content };
    delete scan.rawContent;
    await db.scans.add(scan);
    setPendingScan(null); setSavedResult(null);
    setEditGtin(""); setEditLot(""); setEditExpiry(""); setEditProdDate(""); setEditSerial("");
    setEditContent(""); setIsGS1(false);
    scanningActiveRef.current = true;
    onScanComplete?.();
    if (online) { try { await syncUnsynced(); onScanComplete?.(); } catch { /* */ } }
  }, [pendingScan, isGS1, editGtin, editLot, editExpiry, editProdDate, editSerial, editContent, online, onScanComplete]);

  // ── Nächster Scan ──────────────────────────────────────────
  const handleNextScan = useCallback(() => {
    setSavedResult(null); setPendingScan(null);
    setEditGtin(""); setEditLot(""); setEditExpiry(""); setEditProdDate(""); setEditSerial("");
    setEditContent(""); setIsGS1(false);
    scanningActiveRef.current = true; // Resume scanning
  }, []);

  return (
    <div className="scanner-container">
      <div className="scanner-viewport-compact">
        <video ref={videoRef} autoPlay playsInline muted className="scanner-video" />
        {cameraReady && (
          <>
            <div className="scan-line-overlay">
              <div className="scan-line-dark-top" />
              <div className="scan-line-strip">
                <div className="scan-line" />
              </div>
              <div className="scan-line-dark-bottom" />
            </div>
            <div className="scan-square-overlay" />
          </>
        )}
        {cameraReady && torchAvailable && (
          <button className={`torch-button-top ${torchOn ? "torch-on" : ""}`}
            onClick={toggleTorch} aria-label="Taschenlampe">
            <svg viewBox="0 0 24 24" className="torch-icon">
              <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
            </svg>
          </button>
        )}
      </div>

      {error && <div className="scan-error">{error}</div>}
      {!cameraReady && !error && <div className="scan-loading">Kamera wird gestartet...</div>}

      {pendingScan && (
        <div className="pending-scan-wrapper">
          <div className="last-scan last-scan-pending">
            <div className="last-scan-main">
              <div className="last-scan-label">Scan prüfen &amp; korrigieren</div>
              {isGS1 ? (
                <div className="gs1-fields">
                  {editGtin !== "" && <div className="gs1-field">
                    <label className="gs1-label">(01) GTIN</label>
                    <input className="gs1-input" type="text" inputMode="numeric"
                      value={editGtin} onChange={(e) => setEditGtin(e.target.value)} maxLength={14} />
                  </div>}
                  {editLot !== "" && <div className="gs1-field">
                    <label className="gs1-label">(10) LOT</label>
                    <input className="gs1-input" type="text"
                      value={editLot} onChange={(e) => setEditLot(e.target.value)} />
                  </div>}
                  {editExpiry !== "" && <div className="gs1-field">
                    <label className="gs1-label">(17) Verfall</label>
                    <input className="gs1-input" type="text" inputMode="numeric"
                      value={editExpiry} onChange={(e) => setEditExpiry(e.target.value)} maxLength={6} placeholder="JJMMTT" />
                  </div>}
                  {editProdDate !== "" && <div className="gs1-field">
                    <label className="gs1-label">(11) Herst.</label>
                    <input className="gs1-input" type="text" inputMode="numeric"
                      value={editProdDate} onChange={(e) => setEditProdDate(e.target.value)} maxLength={6} placeholder="JJMMTT" />
                  </div>}
                  {editSerial !== "" && <div className="gs1-field">
                    <label className="gs1-label">(21) Serien-Nr.</label>
                    <input className="gs1-input" type="text"
                      value={editSerial} onChange={(e) => setEditSerial(e.target.value)} />
                  </div>}
                </div>
              ) : (
                <textarea className="scan-edit-field" value={editContent}
                  onChange={(e) => setEditContent(e.target.value)} rows={2} />
              )}
              <div className="last-scan-raw">{pendingScan.rawContent}</div>
              <div className="last-scan-meta">
                <span className="last-scan-type">{pendingScan.code_type}</span>
                <span className="last-scan-time">{formatTime(pendingScan.scanned_at)}</span>
              </div>
            </div>
          </div>
          <div className="scan-action-buttons">
            <button className="scan-discard-button" onClick={handleNextScan}>Verwerfen</button>
            <button className="scan-save-button" onClick={handleSave}>Speichern</button>
          </div>
        </div>
      )}

      {savedResult && (
        <div className="last-scan last-scan-success">
          <div className="last-scan-main">
            <div className="last-scan-label">Gespeichert</div>
            <div className="last-scan-content">{savedResult.content}</div>
            <div className="last-scan-meta">
              <span className="last-scan-type">{savedResult.code_type}</span>
              <span className="last-scan-time">{formatTime(savedResult.scanned_at)}</span>
            </div>
          </div>
          <button className="last-scan-next" onClick={handleNextScan}>Nächster Scan</button>
        </div>
      )}
    </div>
  );
}
