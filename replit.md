# DIY Genie Webhooks Backend

## Overview

Express.js API backend for DIY Genie, a home improvement project management application. The system handles project creation, image uploads, AI-powered preview generation, and plan building with tiered subscription features. Built on Supabase for data storage and integrates with Decor8 (AI design previews) and OpenAI (plan generation) via configurable feature flags.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Core Technologies
- **Runtime**: Node.js with ES modules
- **Framework**: Express.js 5.x
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Storage**: Supabase Storage for image uploads
- **File Processing**: Multer for multipart/form-data handling

### API Design Pattern
Non-blocking asynchronous processing for resource-intensive operations:
- Immediate response to client requests (returns `{ok: true}`)
- Background processing using `setTimeout` for state transitions
- Polling-based status checks via GET endpoints
- Always returns JSON (never HTML errors)

### Authentication & Authorization
- Service-level authentication using Supabase service role key (bypasses RLS)
- User identification via `user_id` parameter in requests
- Dev user constant: `00000000-0000-0000-0000-000000000001`
- No JWT validation at API layer (handled by client/Supabase)

### Subscription Tiers & Entitlements
Three-tier system with quota-based restrictions:

**Free Tier**
- Project quota: 2
- Preview generation: Not allowed
- Plan generation: Allowed

**Casual Tier**
- Project quota: 5
- Preview generation: Allowed
- Plan generation: Allowed

**Pro Tier**
- Project quota: 25
- Preview generation: Allowed
- Plan generation: Allowed

Entitlement enforcement:
- Quota checked before project creation
- Remaining count calculated: `quota - used`
- Preview access gated by `previewAllowed` flag
- Profile auto-creation with 'free' tier if user doesn't exist

### Data Model
**Projects Table** (core entity):
- `id` (UUID, primary key)
- `user_id` (UUID, foreign key to profiles)
- `name` (text)
- `status` (text): 'new' → 'draft' → 'preview_requested' → 'preview_ready' → 'planning' → 'plan_ready'
- `input_image_url` (text, nullable)
- `preview_url` (text, nullable)
- `plan_json` (jsonb, nullable)

**Profiles Table** (user subscription data):
- `user_id` (UUID, primary key)
- `plan_tier` (text): 'free' | 'casual' | 'pro'
- `stripe_customer_id` (text)
- `stripe_subscription_id` (text)
- `stripe_subscription_status` (text)
- `current_period_end` (timestamp)

### Feature Flags & Provider Pattern
Pluggable architecture for AI services with stub fallbacks:

**Preview Generation** (`PREVIEW_PROVIDER`):
- `stub` (default): 5-second delay, uses input image as preview
- `decor8`: Calls Decor8 API `/generate_designs_for_room`, falls back to stub on error

**Plan Generation** (`PLAN_PROVIDER`):
- `stub` (default): 1.5-second delay, no plan data
- `openai`: GPT-4 JSON generation, falls back to stub on error

Rationale: Allows development/testing without API keys, graceful degradation in production

### Image Upload Strategy
Dual-mode image acceptance:
1. **Multipart upload**: File buffer → Supabase Storage → public URL
2. **Direct URL**: Client provides pre-uploaded URL directly

Storage path pattern: `projects/{projectId}/{timestamp}.{ext}`
CORS-enabled public bucket for client access

### CORS Configuration
Permissive development setup:
- Origin: Dynamic (accepts all origins via callback)
- Methods: GET, POST, PATCH, OPTIONS
- Headers: Content-Type, Authorization
- Explicit headers set for compatibility

### Error Handling
Consistent JSON error responses:
```javascript
{ ok: false, error: "error_message" }
```
- HTTP status codes: 400 (bad request), 403 (forbidden), 500 (server error), 502 (external service error)
- Never returns HTML error pages
- Logs all requests: `[REQ] METHOD /path`

### State Machine Pattern
Project lifecycle managed through status field:
1. **new** → Initial creation
2. **draft** → Image uploaded
3. **preview_requested** → Preview generation triggered
4. **preview_ready** → Preview URL available
5. **planning** → Plan generation triggered
6. **plan_ready** → Plan JSON available

Transitions triggered by explicit API calls, not automatic

## External Dependencies

### Supabase
- **Service**: PostgreSQL database + object storage
- **Authentication**: Service role key for server-side operations
- **Usage**: Primary data store, file uploads
- **Environment**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

### Stripe
- **Service**: Payment processing and subscription management
- **Integration**: Webhook-based subscription lifecycle
- **Events Handled**: 
  - `checkout.session.completed` → Create customer/subscription
  - `customer.subscription.*` → Update subscription status
  - `customer.subscription.deleted` → Downgrade to free tier
- **Environment**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CASUAL_PRICE_ID`, `PRO_PRICE_ID`

### Decor8 AI
- **Service**: AI-powered interior design preview generation
- **Endpoint**: `POST /generate_designs_for_room`
- **Input**: `input_image_url`, `room_type`, `design_style`, `num_images`
- **Authentication**: Bearer token
- **Environment**: `DECOR8_BASE_URL`, `DECOR8_API_KEY`
- **Fallback**: Stub mode returns input image after delay

### OpenAI
- **Service**: GPT-4 for structured plan generation
- **Model**: Configurable (default: gpt-4o-mini)
- **Output**: JSON plan with steps and materials
- **Environment**: `OPENAI_API_KEY`, `OPENAI_MODEL`
- **Fallback**: Stub mode returns empty plan after delay

### NPM Packages
- `express` (^5.1.0) - Web framework
- `@supabase/supabase-js` (^2.58.0) - Supabase client
- `multer` (^2.0.2) - Multipart form parsing
- `stripe` (^18.5.0) - Payment processing
- `cors` (^2.8.5) - CORS middleware
- `@stripe/stripe-js` (^7.9.0) - Stripe frontend utilities
- `@stripe/react-stripe-js` (^4.0.2) - Stripe React components