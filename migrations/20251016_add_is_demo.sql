-- Add is_demo column to projects table
-- This allows marking sample/demo projects that don't count against user quotas

-- Add column if missing (idempotent)
alter table public.projects
  add column if not exists is_demo boolean not null default false;

-- Create index to speed up lookups (user's projects excluding demos)
create index if not exists idx_projects_user_demo
  on public.projects (user_id, is_demo);

-- Optional: Add comment for documentation
comment on column public.projects.is_demo is 
  'Marks demo/sample projects that do not count against user quotas';
