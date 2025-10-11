-- PRODUCTION Migration: Add measurement columns to room_scans table
-- Run this in your PRODUCTION Supabase SQL Editor (api.diygenieapp.com database)

-- Add measurement status and result columns if they don't exist
ALTER TABLE room_scans 
ADD COLUMN IF NOT EXISTS measure_status TEXT,
ADD COLUMN IF NOT EXISTS measure_result JSONB;

-- Add index for faster queries on measurement status
CREATE INDEX IF NOT EXISTS idx_room_scans_measure_status 
ON room_scans(measure_status) 
WHERE measure_status IS NOT NULL;

-- Add helpful comments
COMMENT ON COLUMN room_scans.measure_status IS 'Status of measurement processing (e.g., "done", "processing", "failed")';
COMMENT ON COLUMN room_scans.measure_result IS 'JSON result containing px_per_in, width_in, height_in, and optional roi measurements';

-- Verify the columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'room_scans' 
  AND column_name IN ('measure_status', 'measure_result')
ORDER BY column_name;
