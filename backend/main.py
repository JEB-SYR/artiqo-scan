import aiomysql
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from database import get_pool, close_pool
from models import SyncRequest, SyncResponse, ScanOut


async def reverse_geocode(lat: float, lon: float) -> tuple[str | None, str | None]:
    """Nominatim Reverse Geocoding → (plz, ort)"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "json", "zoom": 16},
                headers={"User-Agent": "artiqo-scan/1.0"},
            )
            resp.raise_for_status()
            addr = resp.json().get("address", {})
            plz = addr.get("postcode")
            ort = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality")
            return plz, ort
    except Exception:
        return None, None


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield
    await close_pool()


app = FastAPI(title="artiqo-scan API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://artiqo.deusnet.de", "http://localhost:3004"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT 1")
    return {"status": "ok"}


@app.post("/api/sync", response_model=SyncResponse)
async def sync_scans(req: SyncRequest, request: Request):
    if not req.scans:
        return SyncResponse(synced=0, message="No scans to sync")

    # IP: X-Forwarded-For (Caddy) oder direkte Client-IP
    ip_address = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if not ip_address:
        ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    pool = await get_pool()
    synced = 0
    geo_updates = []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for scan in req.scans:
                try:
                    await cur.execute(
                        """INSERT IGNORE INTO scans
                           (id, content, code_type, scanned_at, device_name, latitude, longitude, ip_address, user_agent)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (
                            scan.id,
                            scan.content,
                            scan.code_type,
                            scan.scanned_at,
                            scan.device_name,
                            scan.latitude,
                            scan.longitude,
                            ip_address,
                            user_agent,
                        ),
                    )
                    if cur.rowcount > 0:
                        synced += 1
                        if scan.latitude and scan.longitude:
                            geo_updates.append((scan.id, scan.latitude, scan.longitude))
                except Exception:
                    pass

    # Reverse Geocoding im Hintergrund (blockiert nicht die Response)
    if geo_updates:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                for scan_id, lat, lon in geo_updates:
                    plz, ort = await reverse_geocode(lat, lon)
                    if plz or ort:
                        await cur.execute(
                            "UPDATE scans SET plz = %s, ort = %s WHERE id = %s",
                            (plz, ort, scan_id),
                        )

    return SyncResponse(synced=synced, message=f"{synced} scans synced")


@app.get("/api/scans", response_model=list[ScanOut])
async def get_scans(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM scans ORDER BY scanned_at DESC LIMIT %s OFFSET %s",
                (limit, offset),
            )
            rows = await cur.fetchall()
    return rows


@app.delete("/api/scans/{scan_id}")
async def delete_scan(scan_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM scans WHERE id = %s", (scan_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Scan not found")
    return {"deleted": scan_id}
