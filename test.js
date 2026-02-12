require('dotenv').config();
const http = require('http');
const https = require('https');

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_TOKEN = process.env.TEST_TOKEN || 'test_token_here';

// Helper function to make requests
function makeRequest(options) {
  return new Promise((resolve, reject) => {
    const protocol = options.protocol === 'https:' ? https : http;
    
    const req = protocol.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Test cases
async function runTests() {
  console.log('🧪 XSEN Orchestrator API Tests\n');
  console.log(`📍 Testing against: ${BASE_URL}\n`);
  console.log('=' .repeat(60));
  
  const url = new URL(BASE_URL);
  
  // Test 1: Health Check
  try {
    console.log('\n✓ Test 1: Health Check (GET /health)');
    const result = await makeRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/health',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`  Status: ${result.status}`);
    console.log(`  Response:`, result.data);
    
    if (result.status === 200 && result.data.status === 'ok') {
      console.log('  ✅ PASS');
    } else {
      console.log('  ❌ FAIL');
    }
  } catch (error) {
    console.log('  ❌ ERROR:', error.message);
  }
  
  // Test 2: Protected endpoint without token
  try {
    console.log('\n✓ Test 2: Protected Endpoint Without Token (GET /api/subscription)');
    const result = await makeRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/api/subscription',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`  Status: ${result.status}`);
    console.log(`  Response:`, result.data);
    
    if (result.status === 401) {
      console.log('  ✅ PASS (Correctly rejected)');
    } else {
      console.log('  ❌ FAIL (Should return 401)');
    }
  } catch (error) {
    console.log('  ❌ ERROR:', error.message);
  }
  
  // Test 3: Protected endpoint with invalid token
  try {
    console.log('\n✓ Test 3: Protected Endpoint With Invalid Token (GET /api/subscription)');
    const result = await makeRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/api/subscription',
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid_token_12345'
      }
    });
    
    console.log(`  Status: ${result.status}`);
    console.log(`  Response:`, result.data);
    
    if (result.status === 401) {
      console.log('  ✅ PASS (Correctly rejected invalid token)');
    } else {
      console.log('  ❌ FAIL (Should return 401)');
    }
  } catch (error) {
    console.log('  ❌ ERROR:', error.message);
  }
  
  // Test 4: Basic chat endpoint
  try {
    console.log('\n✓ Test 4: Basic Chat Endpoint Without Auth (GET /api/chat)');
    const result = await makeRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/api/chat',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`  Status: ${result.status}`);
    console.log(`  Response:`, result.data);
    
    if (result.status === 401) {
      console.log('  ✅ PASS (Correctly requires authentication)');
    } else {
      console.log('  ❌ FAIL');
    }
  } catch (error) {
    console.log('  ❌ ERROR:', error.message);
  }
  
  // Test 5: Premium endpoint
  try {
    console.log('\n✓ Test 5: Premium Chat Endpoint Without Auth (GET /api/chat/premium)');
    const result = await makeRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/api/chat/premium',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`  Status: ${result.status}`);
    console.log(`  Response:`, result.data);
    
    if (result.status === 401) {
      console.log('  ✅ PASS (Correctly requires authentication)');
    } else {
      console.log('  ❌ FAIL');
    }
  } catch (error) {
    console.log('  ❌ ERROR:', error.message);
  }
  
  // Test 6: If test token provided, try authenticated request
  if (TEST_TOKEN && TEST_TOKEN !== 'test_token_here') {
    try {
      console.log('\n✓ Test 6: Authenticated Request (GET /api/subscription)');
      const result = await makeRequest({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: '/api/subscription',
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_TOKEN}`
        }
      });
      
      console.log(`  Status: ${result.status}`);
      console.log(`  Response:`, result.data);
      
      if (result.status === 200 && result.data.email) {
        console.log('  ✅ PASS (Successfully authenticated)');
      } else {
        console.log('  ❌ FAIL');
      }
    } catch (error) {
      console.log('  ❌ ERROR:', error.message);
    }
  } else {
    console.log('\n⏭️  Test 6: Skipped (No TEST_TOKEN provided)');
    console.log('   To test with a real token, set TEST_TOKEN environment variable');
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n🏁 Tests Complete\n');
  console.log('💡 Tips:');
  console.log('   - Set TEST_BASE_URL to test production: export TEST_BASE_URL=https://your-app.up.railway.app');
  console.log('   - Set TEST_TOKEN to test with real auth: export TEST_TOKEN=your_token_here');
  console.log('   - Check Railway logs: railway logs');
  console.log('   - Monitor Stripe webhooks: https://dashboard.stripe.com/webhooks\n');
}

// Run tests
runTests().catch(console.error);
