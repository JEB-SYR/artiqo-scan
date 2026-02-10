import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db/dexie";
import { getPosition } from "../hooks/useGeolocation";
import { getSetting } from "../db/dexie";
import { syncUnsynced } from "../services/syncService";

const SCAN_COOLDOWN_MS = 2000;
const SUPPORTED_FORMATS = [
  0,  // QR_CODE
  4,  // EAN_13
  3,  // EAN_8
  9,  // CODE_128 (inkl. GS1-128)
  8,  // CODE_39
  11, // UPC_A
  12, // UPC_E
  13, // ITF (Interleaved 2 of 5)
  10, // CODABAR
  2,  // DATA_MATRIX
];

// GS1-128 erkennen: beginnt mit FNC1 (]C1) oder enthält GS1 Application Identifiers
function detectGS1128(content, formatName) {
  if (formatName !== "CODE_128") return formatName;
  // FNC1 prefix (vom Scanner als ]C1 oder ASCII GS 29 übermittelt)
  if (content.startsWith("]C1") || content.startsWith("\x1d")) return "GS1_128";
  // Typische AI-Muster: (01), (10), (17), (21), (310x) etc.
  if (/^\(?\d{2,4}\)/.test(content)) return "GS1_128";
  // Rohformat ohne Klammern: beginnt mit 01, 02, 10, 17, 21 + plausible Länge
  if (/^(01\d{14}|02\d{14}|10[A-Za-z0-9]{1,20}|17\d{6}|21[A-Za-z0-9]{1,20})/.test(content)) return "GS1_128";
  return formatName;
}

// Beep via Web Audio API
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1200;
    osc.type = "sine";
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Audio not available
  }
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function calcScanBox() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isLandscape = w > h;
  // Use 85% of screen width, but cap at reasonable max
  const boxWidth = Math.min(Math.floor(w * 0.85), 600);
  // Landscape: flatter box for barcodes; Portrait: still wider than tall
  const boxHeight = isLandscape
    ? Math.min(Math.floor(h * 0.4), 200)
    : Math.min(Math.floor(boxWidth * 0.45), 250);
  return { width: boxWidth, height: boxHeight };
}

export default function Scanner({ online, onScanComplete }) {
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);
  const lastScanRef = useRef(0);
  const [lastResult, setLastResult] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);

  const handleNextScan = useCallback(() => {
    setShowSuccess(false);
    setLastResult(null);
  }, []);

  const handleScan = useCallback(
    async (decodedText, decodedResult) => {
      const now = Date.now();
      if (now - lastScanRef.current < SCAN_COOLDOWN_MS) return;
      lastScanRef.current = now;

      // Audio + Vibration feedback
      playBeep();
      if (navigator.vibrate) navigator.vibrate(100);

      const rawType = decodedResult?.result?.format?.formatName || "UNKNOWN";
      const codeType = detectGS1128(decodedText, rawType);
      const position = await getPosition();
      const deviceName = (await getSetting("device_name")) || "iPhone";

      const scan = {
        id: uuidv4(),
        content: decodedText,
        code_type: codeType,
        scanned_at: new Date().toISOString(),
        device_name: deviceName,
        latitude: position.latitude,
        longitude: position.longitude,
        synced: 0,
      };

      await db.scans.add(scan);
      setLastResult(scan);
      setShowSuccess(true);
      onScanComplete?.();

      // Sync immediately if online
      if (online) {
        try {
          await syncUnsynced();
          onScanComplete?.();
        } catch {
          // Will sync later
        }
      }
    },
    [online, onScanComplete]
  );

  useEffect(() => {
    let mounted = true;
    const qrId = "qr-reader";

    async function startScanner() {
      if (!mounted || !scannerRef.current) return;
      try {
        const html5Qr = new Html5Qrcode(qrId);
        html5QrRef.current = html5Qr;
        await html5Qr.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: calcScanBox(),
            formatsToSupport: SUPPORTED_FORMATS,
          },
          handleScan,
          () => {} // ignore errors during scanning
        );
        if (mounted) {
          setScanning(true);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError("Kamera-Zugriff nicht möglich: " + err.message);
      }
    }

    async function stopScanner() {
      if (html5QrRef.current) {
        try {
          await html5QrRef.current.stop();
          html5QrRef.current.clear();
        } catch {
          // ignore
        }
        html5QrRef.current = null;
      }
    }

    startScanner();

    // Restart camera on visibility change (iOS suspends camera)
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        stopScanner().then(startScanner);
      } else {
        stopScanner();
        if (mounted) setScanning(false);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      stopScanner();
    };
  }, [handleScan]);

  return (
    <div className="scanner-container">
      <div id="qr-reader" ref={scannerRef} className="qr-reader" />
      {error && <div className="scan-error">{error}</div>}
      {!scanning && !error && <div className="scan-loading">Kamera wird gestartet...</div>}
      {lastResult && (
        <div className={`last-scan ${showSuccess ? "last-scan-success" : ""}`}>
          <div className="last-scan-main">
            <div className="last-scan-label">
              {showSuccess ? "\u2713 Scan erfolgreich" : "Letzter Scan:"}
            </div>
            <div className="last-scan-content">{lastResult.content}</div>
            <div className="last-scan-meta">
              <span className="last-scan-type">{lastResult.code_type}</span>
              <span className="last-scan-time">{formatTime(lastResult.scanned_at)}</span>
            </div>
          </div>
          {showSuccess && (
            <button className="last-scan-next" onClick={handleNextScan}>
              Nächster Scan
            </button>
          )}
        </div>
      )}
    </div>
  );
}
