-- Performance optimization migration for projects table
-- Creates indexes for faster queries and auto-updating updated_at timestamp

-- Index for listing projects by user, ordered by most recently updated
CREATE INDEX IF NOT EXISTS idx_projects_user_updated
  ON public.projects (user_id, updated_at DESC);

-- Index for filtering projects by status and user
CREATE INDEX IF NOT EXISTS idx_projects_status_user
  ON public.projects (status, user_id);

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN 
  NEW.updated_at = NOW(); 
  RETURN NEW; 
END $$;

-- Trigger to call the function before any update on projects
DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
