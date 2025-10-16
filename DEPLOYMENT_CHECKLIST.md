# Demo Project Feature - Deployment Checklist

## ⚠️ IMPORTANT: Migration Required

The backend code is complete and ready, but you need to apply the database migration to your **Supabase cloud database** before the feature will work.

## Quick Start (3 Steps)

### 1. Apply Database Migration

Go to your Supabase Dashboard → SQL Editor and run:

```sql
alter table public.projects
  add column if not exists is_demo boolean not null default false;

create index if not exists idx_projects_user_demo
  on public.projects (user_id, is_demo);
```

### 2. Deploy Backend

Click the **"Publish"** button in Replit to deploy the updated backend code.

### 3. Test the Endpoint

```bash
curl -X POST https://your-api.com/api/demo-project \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"YOUR_USER_UUID"}'
```

## What Was Built

✅ **Database Migration** - `migrations/20251016_add_is_demo.sql`  
✅ **API Endpoint** - `POST /api/demo-project` (index.js:901)  
✅ **Documentation** - API_MAP.md updated  
✅ **Implementation Guide** - DEMO_PROJECT_IMPLEMENTATION.md  
✅ **Architecture Documentation** - replit.md updated  

## Feature Overview

The endpoint creates a fully-populated demo project ("Modern Floating Shelves") with:
- Complete plan data (materials, tools, steps, safety notes)
- Before/after images from Unsplash
- Status: `plan_ready` (ready to view immediately)
- Marked with `is_demo=true` (doesn't count against quotas)

**Behavior:**
- First call: Creates demo project
- Subsequent calls: Returns existing demo
- One demo per user
- Can be deleted and recreated

## Integration Example (Mobile App)

```javascript
// Add this to your HomeScreen or ProjectsScreen
async function handleTrySample() {
  const response = await fetch('https://your-api.com/api/demo-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: currentUserId })
  });
  
  const { ok, item } = await response.json();
  if (ok) {
    navigation.navigate('ProjectDetails', { id: item.id });
  }
}

// Add button
<Button title="Try a Sample Project" onPress={handleTrySample} />
```

## Important: Update Quota Logic

Wherever you count projects, exclude demos:

```sql
-- Before
SELECT COUNT(*) FROM projects WHERE user_id = $1

-- After  
SELECT COUNT(*) FROM projects WHERE user_id = $1 AND is_demo = false
```

## Files to Review

1. **Migration:** `migrations/20251016_add_is_demo.sql`
2. **Implementation:** `index.js` (lines 899-1009)
3. **API Docs:** `API_MAP.md` (lines 311-382)
4. **Deployment Guide:** `DEMO_PROJECT_IMPLEMENTATION.md`

## Need Help?

Check `DEMO_PROJECT_IMPLEMENTATION.md` for:
- Detailed deployment steps
- Testing checklist
- Rollback instructions
- Troubleshooting guide

---

**Status:** ✅ Backend ready • ⏳ Migration pending • 📱 Frontend integration needed
