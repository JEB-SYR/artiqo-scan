USE artiqo_scan;

ALTER TABLE scans
  ADD COLUMN ip_address VARCHAR(45) DEFAULT NULL AFTER longitude,
  ADD COLUMN user_agent TEXT DEFAULT NULL AFTER ip_address;
