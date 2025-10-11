-- Migration: Add preview columns to projects table
-- Date: 2025-10-11
-- Purpose: Support preview generation workflow with status tracking

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS preview_status TEXT,
ADD COLUMN IF NOT EXISTS preview_url TEXT,
ADD COLUMN IF NOT EXISTS preview_meta JSONB;

-- Optional: Add index for faster status queries
CREATE INDEX IF NOT EXISTS idx_projects_preview_status ON projects(preview_status);
