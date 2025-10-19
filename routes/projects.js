import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";

const projects = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const UPLOADS_BUCKET = process.env.EXPO_PUBLIC_UPLOADS_BUCKET || "uploads";

// POST /api/projects - Create new project
projects.post("/", async (req, res, next) => {
  try {
    const { name, goal, user_id, client } = req.body;

    // Validate required fields
    if (!user_id) {
      return req.fail("missing_user_id", "user_id is required");
    }
    if (!name || String(name).trim().length < 10) {
      return req.fail("invalid_name", "name must be at least 10 characters");
    }

    // Upsert profile to avoid foreign key errors
    await supabase
      .from('profiles')
      .upsert(
        { user_id, plan_tier: 'free' },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );

    // Create project
    const { data: p, error: projectErr } = await supabase
      .from('projects')
      .insert({
        user_id,
        name: String(name).trim(),
        budget: client?.budget || '$$',
        status: 'draft'
      })
      .select('id, name, user_id, created_at')
      .maybeSingle();

    if (projectErr || !p?.id) {
      throw Object.assign(new Error("Failed to create project"), { 
        code: "create_project_failed",
        hint: projectErr?.message
      });
    }

    console.log(`[POST /api/projects] user_id=${user_id}, project_id=${p.id}`);
    res.status(201).json({ 
      id: p.id, 
      name: p.name, 
      goal: goal || null,
      user_id: p.user_id, 
      created_at: p.created_at 
    });
  } catch (e) { 
    next(Object.assign(e, { code: e.code || "create_project_failed" })); 
  }
});

// POST /api/projects/:id/photo - Attach photo (multipart or JSON {url})
projects.post("/:id/photo", upload.any(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const { url } = req.body || {};
    let photoUrl;

    // Handle direct URL
    if (url) {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return req.fail("invalid_url", "url must be http/https", "Provide a valid image URL");
      }
      photoUrl = url;
    }
    // Handle file upload
    else if (req.files && req.files.length > 0) {
      const file = req.files[0];
      
      if (!file.mimetype || !file.mimetype.startsWith('image/')) {
        return req.fail("invalid_file_type", "File must be an image");
      }
      
      const ext = (file.mimetype?.split('/')[1] || 'jpg').toLowerCase();
      const path = `projects/${id}/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase
        .storage.from(UPLOADS_BUCKET)
        .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
      
      if (upErr) {
        throw Object.assign(new Error("Upload failed"), { 
          code: "upload_failed",
          hint: upErr.message
        });
      }

      const { data: pub } = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(path);
      photoUrl = pub?.publicUrl;
    }
    else {
      return req.fail("missing_file_or_url", "Provide either file upload or url");
    }

    // Update project with image URL
    const { error: dbErr } = await supabase
      .from('projects')
      .update({ input_image_url: photoUrl })
      .eq('id', id);
    
    if (dbErr) {
      throw Object.assign(new Error("Failed to update project"), { 
        code: "update_failed",
        hint: dbErr.message
      });
    }

    res.json({ ok: true, photo_url: photoUrl });
  } catch (e) { 
    next(Object.assign(e, { code: e.code || "attach_photo_failed" })); 
  }
});

// POST /api/projects/:id/preview - Queue preview generation
projects.post("/:id/preview", async (req, res, next) => {
  try {
    const id = req.params.id;
    const { force } = req.body || {};

    // Verify project exists
    const { data: project, error: pErr } = await supabase
      .from('projects')
      .select('id, input_image_url, status')
      .eq('id', id)
      .maybeSingle();

    if (pErr || !project) {
      return req.fail("project_not_found", "Project not found");
    }

    if (!project.input_image_url) {
      return req.fail("missing_photo", "Project must have a photo before generating preview");
    }

    // Update status to indicate preview requested
    await supabase
      .from('projects')
      .update({ 
        status: 'preview_requested',
        preview_status: 'queued'
      })
      .eq('id', id);

    console.log(`[POST /api/projects/:id/preview] project_id=${id}, force=${force}`);
    
    // Return 202 Accepted with queued status
    res.status(202).json({ 
      status: "queued",
      preview_id: null 
    });
  } catch (e) { 
    next(Object.assign(e, { code: e.code || "queue_preview_failed" })); 
  }
});

// GET /api/projects/:id/plan - Get project plan
projects.get("/:id/plan", async (req, res, next) => {
  try {
    const id = req.params.id;

    // Fetch project
    const { data: project, error } = await supabase
      .from('projects')
      .select('id, plan_json')
      .eq('id', id)
      .maybeSingle();
    
    if (error || !project) {
      return req.fail("project_not_found", "Project not found");
    }

    // Extract plan data with defaults
    const plan = project.plan_json || {};
    const planSummary = plan.overview || plan.summary || {};
    
    // Parse cost
    let totalCost = 0;
    const estCostStr = planSummary.est_cost || planSummary.estimatedCost || '';
    if (estCostStr.includes('$')) {
      const costMatch = estCostStr.match(/\$?\s*(\d+)/);
      if (costMatch) totalCost = parseInt(costMatch[1], 10);
    }

    res.json({
      steps: plan.steps || [],
      tools: plan.tools || [],
      materials: plan.materials || [],
      cost_estimate: { 
        total: totalCost, 
        currency: "USD" 
      },
      updated_at: plan.updated_at || new Date().toISOString()
    });
  } catch (e) { 
    next(Object.assign(e, { code: e.code || "get_plan_failed" })); 
  }
});

// POST /api/projects/:id/scan - Attach RoomPlan scan data
projects.post("/:id/scan", async (req, res, next) => {
  try {
    const id = req.params.id;
    const { roomplan } = req.body || {};

    if (!roomplan) {
      return req.fail("missing_roomplan", "roomplan data is required");
    }

    // Verify project exists and get user_id
    const { data: project, error: pErr } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle();

    if (pErr || !project) {
      return req.fail("project_not_found", "Project not found");
    }

    // Store room scan data
    const { error: scanErr } = await supabase
      .from('room_scans')
      .insert({
        project_id: id,
        user_id: project.user_id,
        roi: roomplan,
        measure_status: 'complete'
      });

    if (scanErr) {
      throw Object.assign(new Error("Failed to save scan"), { 
        code: "scan_save_failed",
        hint: scanErr.message
      });
    }

    console.log(`[POST /api/projects/:id/scan] project_id=${id}, scan saved`);
    res.json({ ok: true });
  } catch (e) { 
    next(Object.assign(e, { code: e.code || "attach_scan_failed" })); 
  }
});

export default projects;
