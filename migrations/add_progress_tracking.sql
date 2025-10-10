-- Migration: Add progress tracking columns to projects table
-- Run this in your Supabase SQL Editor

ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS completed_steps INTEGER[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS current_step_index INTEGER DEFAULT 0;

-- Optional: Add comment for documentation
COMMENT ON COLUMN projects.completed_steps IS 'Array of completed step indices';
COMMENT ON COLUMN projects.current_step_index IS 'Index of the current step user is on';
