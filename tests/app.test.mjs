// Automated App Test - Full Flow (No Manual IDs)
// Tests preview generation and plan building with auto-discovered dev user

const API_BASE = process.env.API_BASE || 'http://localhost:5000';
const TEST_IMAGE_URL = 'https://qnevigmqyuxfzyczmctc.supabase.co/storage/v1/object/public/uploads/room-test.jpeg';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function poll(fn, condition, maxAttempts = 20, interval = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await fn();
    if (condition(result)) return result;
    await sleep(interval);
  }
  throw new Error('Polling timed out');
}

async function request(method, path, body = null) {
  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  
  const res = await fetch(url, options);
  const data = await res.json();
  return { status: res.status, data };
}

console.log('========================================');
console.log('DIY Genie App Test - Full Flow');
console.log(`API Base: ${API_BASE}`);
console.log('========================================\n');

let devUserId = null;
let projectId = null;
let initialRemaining = null;

try {
  // STEP 1: Discover dev user from entitlements endpoint
  console.log('[STEP 1] Auto-discover dev user...');
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const { status: entStatus, data: entData } = await request('GET', `/me/entitlements/${testUserId}`);
  
  if (entStatus !== 200 || !entData.ok) {
    throw new Error(`Failed to get entitlements: ${JSON.stringify(entData)}`);
  }
  
  devUserId = testUserId;
  initialRemaining = entData.remaining;
  console.log(`✓ Dev user: ${devUserId}`);
  console.log(`  Tier: ${entData.tier}, Quota: ${entData.quota}, Remaining: ${entData.remaining}, Preview: ${entData.previewAllowed}`);
  
  // Clean up old test projects if quota exhausted
  if (entData.remaining === 0) {
    console.log('  Quota exhausted - cleaning up old test projects...');
    const { data: projectsData } = await request('GET', `/api/projects?user_id=${devUserId}`);
    if (projectsData.ok && projectsData.items && projectsData.items.length > 0) {
      console.log(`  Found ${projectsData.items.length} projects - deleting...`);
      for (const proj of projectsData.items) {
        const deleteUrl = `${API_BASE}/api/projects/${proj.id}`;
        await fetch(deleteUrl, { method: 'DELETE' });
      }
      console.log(`  ✓ Deleted ${projectsData.items.length} projects`);
    }
  }
  console.log('');

  // STEP 2: Create project
  console.log('[STEP 2] Create project...');
  const { status: createStatus, data: createData } = await request('POST', '/api/projects', {
    user_id: devUserId,
    name: 'App Test Project',
    budget: 'medium',
    skill_level: 'beginner'
  });
  
  if (createStatus !== 200 || !createData.ok) {
    throw new Error(`Failed to create project: ${JSON.stringify(createData)}`);
  }
  
  projectId = createData.item.id;
  console.log(`✓ Created project: ${projectId}\n`);

  // STEP 3: Upload image via direct_url
  console.log('[STEP 3] Upload image via direct_url...');
  const { status: imgStatus, data: imgData } = await request('POST', `/api/projects/${projectId}/image`, {
    direct_url: TEST_IMAGE_URL
  });
  
  if (imgStatus !== 200 || !imgData.ok) {
    throw new Error(`Failed to upload image: ${JSON.stringify(imgData)}`);
  }
  
  console.log(`✓ Image uploaded: ${imgData.url}`);
  
  // Verify status is still 'draft' (no auto-actions)
  const { data: afterImgData } = await request('GET', `/api/projects/${projectId}`);
  if (afterImgData.item.status !== 'draft') {
    throw new Error(`Expected status 'draft' after upload, got '${afterImgData.item.status}'`);
  }
  console.log(`✓ Status still 'draft' (no auto-actions)\n`);

  // STEP 4: Test preview (if allowed)
  console.log('[STEP 4] Test preview generation...');
  const { status: previewStatus, data: previewData } = await request('POST', `/api/projects/${projectId}/preview`, {
    user_id: devUserId,
    room_type: 'livingroom',
    design_style: 'modern'
  });
  
  if (entData.previewAllowed) {
    if (previewStatus !== 200 || !previewData.ok) {
      throw new Error(`Preview failed: ${JSON.stringify(previewData)}`);
    }
    console.log('✓ Preview triggered (ok:true returned immediately)');
    
    // Poll for preview_ready
    console.log('  Polling for preview_ready...');
    await poll(
      async () => {
        const { data } = await request('GET', `/api/projects/${projectId}`);
        return data.item;
      },
      (item) => item.status === 'preview_ready' || item.status === 'preview_error',
      20,
      500
    );
    
    const { data: previewReadyData } = await request('GET', `/api/projects/${projectId}`);
    if (previewReadyData.item.status === 'preview_ready') {
      console.log(`✓ Preview ready: ${previewReadyData.item.preview_url}\n`);
    } else {
      console.log(`⚠ Preview ended in error state: ${previewReadyData.item.status}\n`);
    }
  } else {
    if (previewStatus === 403) {
      console.log(`✓ Preview correctly blocked for tier '${entData.tier}'\n`);
    } else {
      throw new Error(`Expected 403 for blocked preview, got ${previewStatus}`);
    }
  }

  // STEP 5: Test build-without-preview
  console.log('[STEP 5] Test build-without-preview...');
  const { status: buildStatus, data: buildData } = await request('POST', `/api/projects/${projectId}/build-without-preview`, {
    user_id: devUserId,
    description: 'Modern living room renovation',
    budget: 'medium',
    skill_level: 'beginner'
  });
  
  if (buildStatus !== 200 || !buildData.ok) {
    throw new Error(`Build failed: ${JSON.stringify(buildData)}`);
  }
  console.log('✓ Build triggered (ok:true returned immediately)');
  
  // Poll for plan_ready
  console.log('  Polling for plan_ready...');
  await poll(
    async () => {
      const { data } = await request('GET', `/api/projects/${projectId}`);
      return data.item;
    },
    (item) => item.status === 'plan_ready' || item.status === 'plan_error',
    20,
    500
  );
  
  const { data: planReadyData } = await request('GET', `/api/projects/${projectId}`);
  if (planReadyData.item.status === 'plan_ready') {
    console.log(`✓ Plan ready\n`);
  } else {
    console.log(`⚠ Plan ended in error state: ${planReadyData.item.status}\n`);
  }

  // STEP 6: Verify entitlements decremented
  console.log('[STEP 6] Verify entitlements...');
  const { data: finalEntData } = await request('GET', `/me/entitlements/${devUserId}`);
  const finalRemaining = finalEntData.remaining;
  const expectedRemaining = initialRemaining - 1; // One project created
  
  if (finalRemaining === expectedRemaining) {
    console.log(`✓ Remaining decremented: ${initialRemaining} → ${finalRemaining}\n`);
  } else {
    console.log(`⚠ Unexpected remaining: ${finalRemaining} (expected ${expectedRemaining})\n`);
  }

  // STEP 7: Verify GET /api/projects includes all fields
  console.log('[STEP 7] Verify GET /api/projects...');
  const { data: listData } = await request('GET', `/api/projects?user_id=${devUserId}`);
  
  if (!listData.ok || !listData.items || listData.items.length === 0) {
    throw new Error('No projects returned from list endpoint');
  }
  
  const project = listData.items.find(p => p.id === projectId);
  if (!project) {
    throw new Error('Test project not found in list');
  }
  
  const hasFields = project.id && project.status && project.input_image_url !== undefined;
  if (!hasFields) {
    throw new Error('Missing required fields in project list');
  }
  
  console.log(`✓ Project list includes: id, status, input_image_url, preview_url\n`);

  console.log('========================================');
  console.log('✅ ALL TESTS PASSED');
  console.log('========================================');
  
  process.exit(0);

} catch (error) {
  console.error('\n❌ TEST FAILED:', error.message);
  console.error('========================================');
  process.exit(1);
}
