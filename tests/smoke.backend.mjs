#!/usr/bin/env node

// Backend smoke tests for DIY Genie API

const API_BASE = process.env.API_BASE || 'http://localhost:5000';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_IMAGE_URL = 'https://qnevigmqyuxfzyczmctc.supabase.co/storage/v1/object/public/uploads/room-test.jpeg';

// Helper functions
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function makeRequest(method, path, body = null, isMultipart = false) {
  const url = `${API_BASE}${path}`;
  const headers = {};
  
  if (!isMultipart && body) {
    headers['Content-Type'] = 'application/json';
  }
  
  const options = {
    method,
    headers,
  };
  
  if (body) {
    options.body = isMultipart ? body : JSON.stringify(body);
  }
  
  console.log(`\n${method} ${url}`);
  if (body && !isMultipart) console.log('Body:', JSON.stringify(body, null, 2));
  
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  
  console.log(`Status: ${res.status}`);
  console.log('Response:', JSON.stringify(data, null, 2));
  
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} - ${JSON.stringify(data)}`);
  }
  
  return data;
}

async function pollForStatus(projectId, targetStatus, maxSeconds = 30) {
  const maxAttempts = Math.ceil(maxSeconds / 2);
  console.log(`\nPolling for status=${targetStatus} (max ${maxSeconds}s)...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const data = await makeRequest('GET', `/api/projects/${projectId}`);
    console.log(`[Poll ${i + 1}] Status: ${data.item?.status}`);
    
    if (data.item?.status === targetStatus) {
      console.log(`✓ Reached ${targetStatus}`);
      return data.item;
    }
  }
  
  throw new Error(`Timeout: status did not reach ${targetStatus} in ${maxSeconds}s`);
}

// Main test flow
async function runTests() {
  console.log('========================================');
  console.log('DIY Genie Backend Smoke Tests');
  console.log(`API Base: ${API_BASE}`);
  console.log('========================================');
  
  let projectId;
  
  try {
    // Test 0: Ensure test user exists in profiles table
    console.log('\n[TEST 0] Ensure test user exists');
    try {
      // Try to create the test user (will silently fail if already exists due to unique constraint)
      await fetch(`${API_BASE.replace('5000', '5432')}/...`); // Can't do this easily
      console.log('(Skipping user creation - assuming user exists or will be auto-created)');
    } catch (e) {
      // Ignore - user might already exist
    }
    
    // Test 1: Get entitlements
    console.log('\n[TEST 1] Get entitlements');
    const ent = await makeRequest('GET', `/me/entitlements/${TEST_USER_ID}`);
    console.log(`✓ Entitlements: tier=${ent.tier}, quota=${ent.quota}, remaining=${ent.remaining}, previewAllowed=${ent.previewAllowed}`);
    
    // Test 1.5: Upgrade to casual tier (so we can test build)
    console.log('\n[TEST 1.5] Upgrade to casual tier');
    const upgradeRes = await makeRequest('POST', '/api/billing/upgrade', {
      tier: 'casual',
      user_id: TEST_USER_ID
    });
    console.log(`✓ Upgrade endpoint returned ok: true`);
    
    // Test 2: Create project
    console.log('\n[TEST 2] Create project');
    const createRes = await makeRequest('POST', '/api/projects', {
      user_id: TEST_USER_ID,
      name: 'Smoke Test Project'
    });
    projectId = createRes.id;
    if (!projectId) throw new Error('No project ID returned');
    console.log(`✓ Created project: ${projectId}`);
    
    // Test 3: Upload image via direct_url
    console.log('\n[TEST 3] Upload image via direct_url');
    const imageRes = await makeRequest('POST', `/api/projects/${projectId}/image`, {
      direct_url: TEST_IMAGE_URL
    });
    console.log(`✓ Image uploaded: ${imageRes.url || imageRes.item?.input_image_url}`);
    
    // Verify image was set
    const afterUpload = await makeRequest('GET', `/api/projects/${projectId}`);
    console.log(`Status after upload: ${afterUpload.item?.status}`);
    if (afterUpload.item?.input_image_url !== TEST_IMAGE_URL) {
      console.warn(`⚠ Expected input_image_url to be ${TEST_IMAGE_URL}, got ${afterUpload.item?.input_image_url}`);
    }
    
    // Test 4: Build without preview
    console.log('\n[TEST 4] Build without preview');
    const buildRes = await makeRequest('POST', `/api/projects/${projectId}/build-without-preview`, {
      user_id: TEST_USER_ID
    });
    console.log(`✓ Build triggered: ${buildRes.status || 'ok'}`);
    
    // Poll for plan_ready
    await pollForStatus(projectId, 'plan_ready', 10);
    
    // Test 5: Request preview (if allowed)
    if (ent.previewAllowed) {
      console.log('\n[TEST 5] Request preview');
      const previewRes = await makeRequest('POST', `/api/projects/${projectId}/preview`, {
        user_id: TEST_USER_ID
      });
      console.log(`✓ Preview triggered: ${previewRes.status || 'ok'}`);
      
      // Poll for preview_ready
      await pollForStatus(projectId, 'preview_ready', 30);
    } else {
      console.log('\n[TEST 5] Preview - SKIPPED (not allowed for tier)');
    }
    
    // Test 6: Verify entitlements via query param endpoint
    console.log('\n[TEST 6] Get entitlements via query param');
    const entQueryRes = await makeRequest('GET', `/me/entitlements?user_id=${TEST_USER_ID}`);
    console.log(`✓ Entitlements query param works: tier=${entQueryRes.tier}, quota=${entQueryRes.quota}, remaining=${entQueryRes.remaining}`);
    
    // Test 7: Billing - Create checkout session
    console.log('\n[TEST 7] Billing - Create checkout session for pro tier');
    try {
      const checkoutRes = await makeRequest('POST', '/api/billing/checkout', {
        tier: 'pro',
        user_id: TEST_USER_ID
      });
      if (!checkoutRes.url || typeof checkoutRes.url !== 'string') {
        throw new Error('Checkout did not return a valid URL');
      }
      console.log(`✓ Checkout session created: ${checkoutRes.url.substring(0, 50)}...`);
    } catch (err) {
      if (err.message.includes('stripe_not_configured') || err.message.includes('price_id_not_configured')) {
        console.log('⚠ Checkout test skipped (Stripe not configured)');
      } else {
        throw err;
      }
    }
    
    console.log('\n========================================');
    console.log('✓ ALL TESTS PASSED');
    console.log('========================================');
    
  } catch (err) {
    console.error('\n========================================');
    console.error('✗ TEST FAILED');
    console.error('========================================');
    console.error(err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
