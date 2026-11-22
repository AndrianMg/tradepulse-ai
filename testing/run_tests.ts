import assert from 'node:assert/strict';
import app from '../src/server';
import { validateRomfordPostcode } from '../src/utils/postcode';
import { buildAlertMessageBody, formatE164UK } from '../src/services/sms';
import mockPayloads from './mock_payloads.json';

async function runTestSuite() {
  console.log('======================================================================');
  console.log('🧪 TradePulse AI Test Suite - Romford (RM1-RM7) Voice Triage Backend');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // --- UNIT TESTS: POSTCODE VALIDATION ---
  console.log('📦 1. Testing Romford Postcode Validation (RM1-RM7)...');

  test('Validates full Romford postcode (RM1 4AU)', () => {
    const res = validateRomfordPostcode('RM1 4AU');
    assert.equal(res.isInCoverage, true);
    assert.equal(res.outwardCode, 'RM1');
    assert.equal(res.normalizedPostcode, 'RM1 4AU');
  });

  test('Validates outward district only (RM5)', () => {
    const res = validateRomfordPostcode('RM5');
    assert.equal(res.isInCoverage, true);
    assert.equal(res.outwardCode, 'RM5');
  });

  test('Normalizes speech quirks ("are em 3" / "R M 7")', () => {
    const res1 = validateRomfordPostcode('are em 3');
    assert.equal(res1.isInCoverage, true);
    assert.equal(res1.outwardCode, 'RM3');

    const res2 = validateRomfordPostcode('R M 7');
    assert.equal(res2.isInCoverage, true);
    assert.equal(res2.outwardCode, 'RM7');
  });

  test('Resolves locality name fallbacks ("Harold Wood", "Collier Row")', () => {
    const res1 = validateRomfordPostcode('Living near Harold Wood station');
    assert.equal(res1.isInCoverage, true);
    assert.equal(res1.outwardCode, 'RM3');

    const res2 = validateRomfordPostcode('House in Collier Row');
    assert.equal(res2.isInCoverage, true);
    assert.equal(res2.outwardCode, 'RM5');
  });

  test('Flags out-of-coverage postcodes (IG11, E17, CM14)', () => {
    const res1 = validateRomfordPostcode('IG11 8TN');
    assert.equal(res1.isInCoverage, false);
    assert.equal(res1.outwardCode, 'IG11');

    const res2 = validateRomfordPostcode('E17 3AA');
    assert.equal(res2.isInCoverage, false);

    const res3 = validateRomfordPostcode('CM14 4AB');
    assert.equal(res3.isInCoverage, false);
  });

  // --- UNIT TESTS: SMS MESSAGE FORMATTING ---
  console.log('\n📲 2. Testing Contractor SMS Alert Formatting...');

  test('Formats emergency alert with clickable tel link and required schema', () => {
    const msg = buildAlertMessageBody({
      isEmergency: true,
      callerName: 'David Miller',
      callerPhone: '07700900123',
      issueSummary: 'Burst main pipe under kitchen sink flooding floor',
      postcode: 'RM1 4AU',
    });

    assert.ok(msg.startsWith('🚨 TradePulse Alert: [EMERGENCY] from David Miller (+447700900123).'));
    assert.ok(msg.includes('Issue: Burst main pipe under kitchen sink flooding floor.'));
    assert.ok(msg.includes('Location: RM1 4AU.'));
    assert.ok(msg.endsWith('Tap to call back: tel:+447700900123'));
  });

  test('Formats standard alert for routine work', () => {
    const msg = buildAlertMessageBody({
      isEmergency: false,
      callerName: 'Sarah Jenkins',
      callerPhone: '+447700900456',
      issueSummary: 'Boiler annual service',
      postcode: 'RM5 2TX',
    });

    assert.ok(msg.includes('[STANDARD]'));
    assert.ok(msg.includes('Location: RM5 2TX.'));
  });

  test('Normalizes UK phone numbers to E.164 (+44)', () => {
    assert.equal(formatE164UK('07911123456'), '+447911123456');
    assert.equal(formatE164UK('+447911123456'), '+447911123456');
    assert.equal(formatE164UK('01708123456'), '+441708123456');
  });

  // --- INTEGRATION TESTS: FASTIFY WEBHOOK ENDPOINT ---
  console.log('\n🌐 3. Testing Webhook Endpoint (POST /api/vapi/webhook)...');

  await asyncTest('Processes Emergency Call (RM1 4AU) and triggers dispatch', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/vapi/webhook',
      payload: mockPayloads.emergency_rm1,
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.equal(body.status, 'success');
    assert.equal(body.emergency, true);
    assert.equal(body.postcode, 'RM1 4AU');
    assert.equal(body.inCoverage, true);
    assert.equal(body.smsDispatched, true);
  });

  await asyncTest('Enforces Webhook Idempotency on repeated delivery', async () => {
    // Inject the exact same emergency payload a second time
    const response = await app.inject({
      method: 'POST',
      url: '/api/vapi/webhook',
      payload: mockPayloads.emergency_rm1,
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.equal(body.action, 'ignored_duplicate');
    assert.equal(body.callId, 'call_vapi_romford_emergency_001');
  });

  await asyncTest('Processes Standard Call (RM5 2TX)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/vapi/webhook',
      payload: mockPayloads.standard_rm5,
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.equal(body.emergency, false);
    assert.equal(body.postcode, 'RM5 2TX');
    assert.equal(body.inCoverage, true);
  });

  await asyncTest('Identifies Out-of-Area Call (IG11 8TN) and tags non-coverage', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/vapi/webhook',
      payload: mockPayloads.out_of_area_ig11,
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.equal(body.inCoverage, false);
    assert.ok(body.postcode.includes('IG11'));
  });

  await asyncTest('Handles Incomplete / Dropped Call Fallback gracefully', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/vapi/webhook',
      payload: mockPayloads.incomplete_transcript_fallback,
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.equal(body.status, 'success');
    // Harold Wood was in the transcript, so it captures RM3
    assert.equal(body.postcode, 'RM3');
    assert.equal(body.inCoverage, true);
    assert.equal(body.smsDispatched, true);
  });

  console.log('\n======================================================================');
  console.log(`🏁 Test Results: ${passed} passed, ${failed} failed`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
