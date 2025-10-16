# Demo Project Feature - Implementation Guide

## Overview
Added "Try a Sample Project" feature that allows users to instantly explore a fully-populated demo project without counting against their quota.

## What's Included

### 1. Database Migration
**File:** `migrations/20251016_add_is_demo.sql`

Adds `is_demo` boolean column to the `projects` table to mark demo/sample projects.

```sql
alter table public.projects
  add column if not exists is_demo boolean not null default false;

create index if not exists idx_projects_user_demo
  on public.projects (user_id, is_demo);
```

### 2. API Endpoint
**Route:** `POST /api/demo-project`  
**Handler:** `index.js:901`

Creates or fetches an existing demo project for a user. Includes:
- Full plan data (Modern Floating Shelves project)
- Before/after images from Unsplash
- Materials, tools, cut list, steps, safety notes
- Status: `plan_ready` (ready to view immediately)

**Key Features:**
- ✅ Idempotent - returns existing demo if already created
- ✅ Does NOT count against user quotas
- ✅ One demo per user
- ✅ Can be deleted and recreated
- ✅ Full plan JSON included

### 3. Documentation
**File:** `API_MAP.md` - Updated with complete endpoint specification

## Deployment Steps

### Step 1: Apply Database Migration

**Option A: Using Supabase Dashboard (Recommended)**

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Run the migration from `migrations/20251016_add_is_demo.sql`:

```sql
alter table public.projects
  add column if not exists is_demo boolean not null default false;

create index if not exists idx_projects_user_demo
  on public.projects (user_id, is_demo);

comment on column public.projects.is_demo is 
  'Marks demo/sample projects that do not count against user quotas';
```

**Option B: Using Supabase CLI**

```bash
supabase db push
```

### Step 2: Deploy Backend Changes

The API endpoint is already implemented in `index.js`. Simply deploy your backend:

1. Push changes to your repository
2. Click the "Publish" button in Replit
3. Or deploy via your CI/CD pipeline

### Step 3: Verify Deployment

Test the endpoint:

```bash
# Replace with your actual API URL and user ID
curl -X POST https://your-api.com/api/demo-project \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"YOUR_USER_UUID"}'
```

Expected response (first call):
```json
{
  "ok": true,
  "item": {
    "id": "generated-uuid",
    "name": "Modern Floating Shelves (Demo)",
    "status": "plan_ready",
    "input_image_url": "https://images.unsplash.com/...",
    "preview_url": "https://images.unsplash.com/..."
  },
  "existed": false
}
```

Expected response (subsequent calls):
```json
{
  "ok": true,
  "item": { ... },
  "existed": true
}
```

### Step 4: Update Quota Logic (Important!)

Wherever you count projects for quota enforcement, exclude demo projects:

**Before:**
```sql
SELECT COUNT(*) FROM projects WHERE user_id = $1
```

**After:**
```sql
SELECT COUNT(*) FROM projects WHERE user_id = $1 AND is_demo = false
```

**Example locations to update:**
- Project list queries
- Quota checking functions
- Analytics/metrics queries
- User dashboard counts

### Step 5: Frontend Integration

Add the "Try a Sample Project" button to your mobile app:

```javascript
// In HomeScreen.js or ProjectsScreen.js
async function handleTrySample() {
  try {
    const userId = await getCurrentUserId();
    const response = await fetch('https://your-api.com/api/demo-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId })
    });
    
    const { ok, item } = await response.json();
    if (ok) {
      // Navigate to project details
      navigation.navigate('ProjectDetails', { id: item.id });
    }
  } catch (e) {
    console.error('[sample project] failed', e);
    alert('Could not create sample project. Please try again.');
  }
}

// Add button in your UI
<Button title="Try a Sample Project" onPress={handleTrySample} />
```

## Demo Project Data

The demo includes a complete "Modern Floating Shelves" project with:

- **Summary:** Title, estimated time (4 hours), cost ($85)
- **Images:** Before/after photos from Unsplash
- **Materials:** 3 items (plywood, edge banding, screws)
- **Tools:** 3 required (saw, drill, level) + 1 optional (miter saw)
- **Cut List:** 2 cut patterns
- **Steps:** 5 detailed steps with durations
- **Safety:** 3 safety notes
- **Tips:** 2 helpful tips

## Testing Checklist

- [ ] Migration applied successfully (check `is_demo` column exists)
- [ ] First call creates demo project (`existed: false`)
- [ ] Second call returns same demo (`existed: true`)
- [ ] Demo project has `is_demo = true` in database
- [ ] Demo project has full `plan_json` data
- [ ] GET `/api/projects/:id/plan` works with demo project ID
- [ ] Demo project visible in user's project list
- [ ] Demo project can be deleted
- [ ] After deletion, endpoint creates new demo
- [ ] Quota counts exclude demo projects

## Rollback Instructions

If you need to rollback:

1. **Remove the column:**
```sql
alter table public.projects drop column if exists is_demo;
drop index if exists idx_projects_user_demo;
```

2. **Revert code changes:**
```bash
git revert <commit-hash>
```

3. **Redeploy backend**

## Additional Notes

### Quota Enforcement
Demo projects are marked with `is_demo=true` and should be excluded from:
- Project count quotas
- Preview/plan generation quotas  
- Analytics and metrics
- Billing calculations

### Data Retention
Demo projects can be deleted by users without affecting quotas. The endpoint is idempotent - if deleted, calling it again will recreate the demo.

### Customization
To customize the demo project data, edit the `demoPlanJson` object in `index.js` (line 940).

### Images
Uses stable Unsplash CDN URLs that won't expire:
- Before: `photo-1582582429416-456273091821`
- After: `photo-1549187774-b4e9b0445b41`

## Support

If you encounter issues:
1. Check server logs for error messages
2. Verify migration was applied: `SELECT column_name FROM information_schema.columns WHERE table_name='projects' AND column_name='is_demo'`
3. Test endpoint manually with curl
4. Check user_id format (must be valid UUID)

## Summary

✅ Database migration created  
✅ API endpoint implemented  
✅ Documentation updated  
✅ Deployment guide provided  

**Ready for deployment!** Just apply the migration and deploy the backend.
