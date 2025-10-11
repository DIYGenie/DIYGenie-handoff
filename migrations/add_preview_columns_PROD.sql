-- Migration: Add preview columns to projects table (PRODUCTION)
-- Date: 2025-10-11
-- Purpose: Support minimal preview generation workflow with status tracking
-- Run this in Supabase SQL Editor for PRODUCTION database

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS preview_status TEXT,
ADD COLUMN IF NOT EXISTS preview_url TEXT,
ADD COLUMN IF NOT EXISTS preview_meta JSONB;

-- Optional: Add index for faster status queries
CREATE INDEX IF NOT EXISTS idx_projects_preview_status ON projects(preview_status);

-- Verify columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'projects' 
AND column_name IN ('preview_status', 'preview_url', 'preview_meta');
