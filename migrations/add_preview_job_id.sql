-- Migration: Add preview_job_id column to projects table
-- Date: 2025-10-11
-- Purpose: Track Decor8 job IDs for real-time preview generation

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS preview_job_id TEXT;

-- Verify column was added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'projects' 
AND column_name = 'preview_job_id';
