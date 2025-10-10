-- Migration: Add measurement columns to room_scans table
-- Run this in your Supabase SQL Editor

-- Add measurement status and result columns
ALTER TABLE room_scans 
ADD COLUMN IF NOT EXISTS measure_status TEXT,
ADD COLUMN IF NOT EXISTS measure_result JSONB;

-- Optional: Add index for faster queries on measurement status
CREATE INDEX IF NOT EXISTS idx_room_scans_measure_status 
ON room_scans(measure_status) 
WHERE measure_status IS NOT NULL;

-- Comment for reference
COMMENT ON COLUMN room_scans.measure_status IS 'Status of measurement processing (e.g., "done", "processing", "failed")';
COMMENT ON COLUMN room_scans.measure_result IS 'JSON result containing px_per_in, width_in, height_in measurements';
