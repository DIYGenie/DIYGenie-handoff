# DIY Genie Webhooks Backend

## Overview
The DIY Genie Webhooks Backend is an Express.js API designed for the DIY Genie home improvement project management application. Its core purpose is to manage project lifecycles, including creation, image uploads, AI-powered design preview generation, and detailed plan building. The system supports tiered subscription models with varying feature access and integrates with external AI services for design and planning. The overarching business vision is to provide a comprehensive, AI-assisted platform for home improvement enthusiasts to plan and execute projects efficiently.

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
The API employs a non-blocking asynchronous processing model, providing immediate client responses and handling resource-intensive operations in the background. Status checks are polling-based, and all responses are consistently JSON.

### Authentication & Authorization
Service-level authentication is managed via a Supabase service role key, bypassing Row Level Security. User identification is based on a `user_id` (UUID) provided in the request body. Projects and builds are associated with the authenticated user's ID.

### Subscription Tiers & Entitlements
The system supports three tiers: Free, Casual, and Pro, each with specific project quotas, preview generation access, and plan generation capabilities. Entitlements are enforced by checking quotas and feature flags before project creation or feature usage.

### Data Model
- **Projects Table**: Manages core project data including `id`, `user_id`, `name`, `status` (lifecycle stages), `input_image_url`, `preview_url`, `preview_status`, `preview_meta`, `plan_json`, `completed_steps`, `current_step_index`, and `is_demo`.
- **Profiles Table**: Stores user subscription details including `user_id`, `plan_tier`, and Stripe-related IDs and statuses.
- **Room Scans Table**: Stores AR scan data associated with projects, including `id`, `project_id`, `roi`, `measure_status`, and `measure_result`.

### Feature Flags & Provider Pattern
A pluggable architecture using feature flags (`PREVIEW_PROVIDER`, `PLAN_PROVIDER`) allows switching between stub implementations (for development/fallback) and live AI services (Decor8 for previews, OpenAI for plans). This ensures graceful degradation and flexible service integration.

### Image Upload Strategy
The system supports two methods for image uploads: direct multipart file upload to Supabase Storage and acceptance of pre-uploaded image URLs provided by the client.

### Error Handling
Errors are returned as consistent JSON objects (`{ ok: false, error: "error_message" }`) with appropriate HTTP status codes (e.g., 400, 403, 500), avoiding HTML error pages.

### State Machine Pattern
Project lifecycle is managed via a `status` field in the Projects table, transitioning through states like `new`, `draft`, `preview_requested`, `preview_ready`, `planning`, and `plan_ready`, triggered by explicit API calls.

## Performance Optimizations

### Database Indexes (October 2025)
Two composite indexes were added to the `projects` table to improve query performance:
- **idx_projects_user_updated**: `(user_id, updated_at DESC)` - Optimizes project lists ordered by recent updates
- **idx_projects_status_user**: `(status, user_id)` - Enables fast status-filtered queries

An auto-updating trigger (`trg_projects_updated_at`) ensures the `updated_at` timestamp is refreshed on every project modification.

### Lightweight API Endpoint
**GET /api/projects/cards** - A performance-optimized endpoint for project lists with:
- Minimal payload size (6 fields vs 15+)
- Built-in pagination (limit/offset)
- CDN-optimized thumbnail URLs
- Leverages the new database indexes

### Image Transformations
The `lib/image.js` utility provides zero-cost thumbnailing via Supabase's CDN:
- Automatically appends `?width=640&quality=70&resize=contain` to Supabase Storage URLs
- Safely handles external URLs (returns unchanged)
- Reduces image bandwidth by 95%+

See `docs/PERF_NOTES.md` for detailed documentation.

## External Dependencies

- **Supabase**: Primary database (PostgreSQL) and object storage.
- **Stripe**: Payment processing and subscription management via webhooks for `checkout.session.completed`, `customer.subscription.*`, and `customer.subscription.deleted` events.
- **Decor8 AI**: AI-powered interior design preview generation service, integrated via a POST endpoint.
- **OpenAI**: GPT-4 for structured plan generation, used for producing JSON plans.
- **NPM Packages**: Key packages include `express`, `@supabase/supabase-js`, `multer`, `stripe`, `cors`, `@stripe/stripe-js`, and `@stripe/react-stripe-js`.