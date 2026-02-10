-- Reverse Geocoding Spalten
ALTER TABLE scans ADD COLUMN plz VARCHAR(10) NULL AFTER longitude;
ALTER TABLE scans ADD COLUMN ort VARCHAR(100) NULL AFTER plz;
