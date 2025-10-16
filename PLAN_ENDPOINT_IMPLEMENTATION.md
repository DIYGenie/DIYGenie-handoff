# GET /api/projects/:id/plan - Implementation Summary

## Overview
Created comprehensive GET endpoint that returns all data needed for the Plan screen in a single JSON response.

## Endpoint Details

**Route:** `GET /api/projects/:id/plan`  
**Handler:** `index.js:1242`  
**Auth:** None (service-level)

## Response Schema (Frozen)

```json
{
  "projectId": "string",
  "summary": {
    "title": "string",
    "heroImageUrl": "string|null",
    "estTimeHours": 0,
    "estCostUsd": 0
  },
  "preview": {
    "beforeUrl": "string|null",
    "afterUrl": "string|null"
  },
  "materials": [
    {
      "name": "string",
      "qty": 0,
      "unit": "string",
      "subtotalUsd": 0
    }
  ],
  "tools": {
    "required": ["string"],
    "optional": ["string"]
  },
  "cutList": {
    "items": [
      {
        "board": "string",
        "dims": "string",
        "qty": 0
      }
    ],
    "layoutSvgUrl": "string|null"
  },
  "steps": [
    {
      "n": 1,
      "title": "string",
      "text": "string",
      "diagramUrl": "string|null"
    }
  ],
  "safety": {
    "notes": ["string"]
  },
  "permits": {
    "needed": false,
    "note": "string"
  },
  "quota": {
    "tier": "free|casual|pro",
    "plansUsed": 0,
    "plansLimit": 0
  }
}
```

## Sample Requests

### 1. Successful Request (existing project)
```bash
curl http://localhost:5000/api/projects/b904c604-c12b-4c5d-a6dd-548908913f9f/plan
```

**Response (200 OK):**
```json
{
  "projectId": "b904c604-c12b-4c5d-a6dd-548908913f9f",
  "summary": {
    "title": "Modern Floating Shelves",
    "heroImageUrl": null,
    "estTimeHours": 4,
    "estCostUsd": 85
  },
  "preview": {
    "beforeUrl": null,
    "afterUrl": null
  },
  "materials": [
    {
      "name": "Birch plywood 3/4\" (4x8)",
      "qty": 1,
      "unit": "sheet",
      "subtotalUsd": 68
    },
    {
      "name": "Edge banding",
      "qty": 1,
      "unit": "ea",
      "subtotalUsd": 7.5
    },
    {
      "name": "Wood screws 2.5\"",
      "qty": 1,
      "unit": "box",
      "subtotalUsd": 9.5
    }
  ],
  "tools": {
    "required": ["Circular saw", "Drill", "Level"],
    "optional": ["Miter saw"]
  },
  "cutList": {
    "items": [
      {
        "board": "Birch plywood",
        "dims": "48\" x 10\"",
        "qty": 2
      },
      {
        "board": "Birch plywood",
        "dims": "12\" x 10\"",
        "qty": 4
      }
    ],
    "layoutSvgUrl": null
  },
  "steps": [
    {
      "n": 1,
      "title": "Cut shelves",
      "text": "Cut plywood to size using circular saw",
      "diagramUrl": null
    },
    {
      "n": 2,
      "title": "Apply edge banding",
      "text": "Iron on edge banding to all exposed edges",
      "diagramUrl": null
    },
    {
      "n": 3,
      "title": "Locate studs",
      "text": "Use stud finder to mark wall studs",
      "diagramUrl": null
    },
    {
      "n": 4,
      "title": "Install brackets",
      "text": "Mount floating shelf brackets to studs",
      "diagramUrl": null
    },
    {
      "n": 5,
      "title": "Attach shelves",
      "text": "Slide shelves onto brackets and secure",
      "diagramUrl": null
    }
  ],
  "safety": {
    "notes": [
      "Wear safety glasses when cutting",
      "Use dust mask for sanding",
      "Ensure proper wall anchoring for load capacity"
    ]
  },
  "permits": {
    "needed": false,
    "note": "Check local building codes for structural modifications"
  },
  "quota": {
    "tier": "free",
    "plansUsed": 1,
    "plansLimit": 2
  }
}
```

### 2. Project Not Found (404)
```bash
curl http://localhost:5000/api/projects/00000000-0000-0000-0000-000000000999/plan
```

**Response (404 Not Found):**
```json
{
  "ok": false,
  "error": "project_not_found"
}
```

## Implementation Details

### Data Sources
1. **Project Data**: Fetched from `projects` table
   - Fields: `id`, `user_id`, `status`, `plan_json`, `name`, `input_image_url`, `preview_url`
   
2. **Quota Data**: Fetched from `profiles` table
   - Fields: `subscription_tier`, `plan_tier`
   - Counts user's total projects for quota calculation

3. **Plan Data**: Extracted from `projects.plan_json` (JSONB)
   - Supports multiple field name variations for backward compatibility
   - Provides sensible defaults for missing fields

### Data Mapping
- **Time Parsing**: Converts "3-4 hours" → `estTimeHours: 4`
- **Cost Parsing**: Converts "$85" → `estCostUsd: 85`
- **Tools Categorization**: Splits into `required` and `optional` based on `optional` flag
- **Materials**: Maps qty, unit, subtotal fields with fallbacks
- **Steps**: Auto-numbers if `order` field missing

### Error Handling
- **404**: Project not found
- **500**: Database errors or server exceptions
- **Quota Fallback**: Returns default `{tier: 'free', plansUsed: 0, plansLimit: 2}` if quota fetch fails

### Performance
- Response size: Kept under 1.5 MB
- No inline blobs: Uses URLs for images and diagrams
- Single database query for project data
- Optional quota fetch (graceful degradation)

## Validation
- **JSDoc Comments**: Added comprehensive documentation
- **Field Types**: Enforced through parsing (parseInt, parseFloat)
- **Array Safety**: Checks `Array.isArray()` before mapping
- **Null Safety**: Uses optional chaining and fallback values

## Documentation
Updated `API_MAP.md` with:
- Complete schema specification
- Sample requests and responses
- Error codes and handling
- Performance notes
- Data source details

## Testing
✅ All fields validated:
- projectId ✓
- summary ✓
- preview ✓
- materials ✓ (3 items)
- tools ✓ (3 required, 1 optional)
- cutList ✓ (2 cuts)
- steps ✓ (5 steps)
- safety ✓ (3 notes)
- permits ✓
- quota ✓ (tier: free, 1/2)

## Assumptions
1. No TypeScript types needed (JavaScript/ES6 project)
2. Quota/entitlement checking handled at project creation, not at plan retrieval
3. Layout SVG URLs and diagram URLs not yet implemented (return `null`)
4. Permits default to `needed: false` with generic note
5. Costs kept in USD, measurements in project-defined units
