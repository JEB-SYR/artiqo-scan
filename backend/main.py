import aiomysql
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from database import get_pool, close_pool
from models import SyncRequest, SyncResponse, ScanOut


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
                    synced += cur.rowcount
                except Exception:
                    pass
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
