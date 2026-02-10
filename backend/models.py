from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ScanItem(BaseModel):
    id: str
    content: str
    code_type: str
    scanned_at: datetime
    device_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class SyncRequest(BaseModel):
    scans: list[ScanItem]


class SyncResponse(BaseModel):
    synced: int
    message: str


class ScanOut(BaseModel):
    id: str
    content: str
    code_type: str
    scanned_at: datetime
    device_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    plz: Optional[str] = None
    ort: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: Optional[datetime] = None
