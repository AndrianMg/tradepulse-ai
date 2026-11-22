# TradePulse AI - Testing & Deployment Guide

This guide explains how to run TradePulse AI locally, expose it using **ngrok**, simulate calls using **cURL**, and connect it to your live Vapi or Retell AI dashboard.

---

## 1. Setup & Environment

Ensure you have your environment variables defined. Duplicate `.env.example` to `.env`:

```bash
cp .env.example .env
```

If testing locally without live Twilio / Supabase keys, TradePulse AI automatically runs in **safe simulation mode**:
- Twilio SMS output is printed to the terminal console with the exact message body.
- Supabase records are stored in an in-memory transactional store for idempotency testing.

---

## 2. Running Automated Tests

Run the comprehensive test suite verifying:
1. Romford RM1–RM7 postcode parsing, phonetic transcription normalization, and locality mapping.
2. Exact alert SMS template generation and `tel:` links.
3. Fastify webhook processing, out-of-area tagging, and duplicate webhook idempotency deduplication.

```bash
npm test
```

---

## 3. Starting the Local Webhook Server

Start the development server with live reload:

```bash
npm run dev
```

The server will listen at:
```
http://localhost:3000
```
- Health Check: `http://localhost:3000/health`
- Webhook URL: `http://localhost:3000/api/vapi/webhook`

---

## 4. Exposing via ngrok for Live Telephony Testing

To allow Vapi or Retell AI to send real-time webhooks to your local machine:

1. Install and start ngrok:
   ```bash
   ngrok http 3000
   ```

2. Copy the resulting HTTPS forwarding URL (e.g., `https://abc1-23-45-67.ngrok-free.app`).

3. Your public webhook endpoint for the Vapi/Retell dashboard is:
   ```
   https://abc1-23-45-67.ngrok-free.app/api/vapi/webhook
   ```

4. Paste this URL into your **Vapi Assistant Dashboard** -> **Advanced** -> **Server URL**.

---

## 5. Mock Testing with cURL

You can test every edge case immediately from your terminal using the mock payloads in `testing/mock_payloads.json`.

### Test Case A: Emergency Burst Pipe in Romford Centre (RM1 4AU)
```bash
curl -X POST http://localhost:3000/api/vapi/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "type": "end-of-call-report",
      "call": {
        "id": "curl_test_emergency_001",
        "assistantId": "asst_vapi_romford_001",
        "status": "completed",
        "durationSeconds": 75,
        "recordingUrl": "https://api.vapi.ai/recordings/test_001.mp3",
        "customer": {
          "number": "+447700900123",
          "name": "David Miller"
        }
      },
      "analysis": {
        "summary": "Customer has a burst main pipe under the kitchen sink flooding hallway.",
        "structuredData": {
          "caller_name": "David Miller",
          "caller_phone": "+447700900123",
          "emergency": true,
          "issue_description": "Burst pipe under kitchen sink flooding floor",
          "postcode": "RM1 4AU"
        }
      },
      "transcript": "Hello, my pipe burst at RM1 4AU..."
    }
  }'
```

**Expected Response**:
```json
{
  "status": "success",
  "callId": "curl_test_emergency_001",
  "emergency": true,
  "postcode": "RM1 4AU",
  "inCoverage": true,
  "smsDispatched": true
}
```

**Expected SMS Dispatched to Contractor**:
```
🚨 TradePulse Alert: [EMERGENCY] from David Miller (+447700900123). Issue: Burst pipe under kitchen sink flooding floor. Location: RM1 4AU. Tap to call back: tel:+447700900123
```

---

### Test Case B: Idempotency Protection (Re-sending identical Call ID)
Run the exact same cURL command above immediately a second time.

**Expected Response**:
```json
{
  "status": "success",
  "action": "ignored_duplicate",
  "callId": "curl_test_emergency_001",
  "message": "Webhook previously processed and recorded."
}
```
*Notice: No duplicate SMS was dispatched, and no duplicate database record was created.*

---

### Test Case C: Standard Routine Booking in Collier Row (RM5 2TX)
```bash
curl -X POST http://localhost:3000/api/vapi/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "type": "end-of-call-report",
      "call": {
        "id": "curl_test_standard_002",
        "assistantId": "asst_vapi_romford_001",
        "status": "completed",
        "durationSeconds": 45,
        "customer": {
          "number": "+447700900456",
          "name": "Sarah Jenkins"
        }
      },
      "analysis": {
        "summary": "Annual boiler service booking.",
        "structuredData": {
          "caller_name": "Sarah Jenkins",
          "caller_phone": "+447700900456",
          "emergency": false,
          "issue_description": "Annual boiler safety check",
          "postcode": "RM5 2TX"
        }
      }
    }
  }'
```

**Expected SMS Dispatched to Contractor**:
```
🚨 TradePulse Alert: [STANDARD] from Sarah Jenkins (+447700900456). Issue: Annual boiler safety check. Location: RM5 2TX. Tap to call back: tel:+447700900456
```

---

### Test Case D: Out-of-Area Caller in Barking (IG11 8TN)
```bash
curl -X POST http://localhost:3000/api/vapi/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "type": "end-of-call-report",
      "call": {
        "id": "curl_test_out_of_area_003",
        "assistantId": "asst_vapi_romford_001",
        "status": "completed",
        "durationSeconds": 50,
        "customer": {
          "number": "+447700900789",
          "name": "Marcus Reid"
        }
      },
      "analysis": {
        "structuredData": {
          "caller_name": "Marcus Reid",
          "caller_phone": "+447700900789",
          "emergency": false,
          "issue_description": "Radiator leaking in Barking",
          "postcode": "IG11 8TN"
        }
      }
    }
  }'
```

**Expected SMS Dispatched to Contractor**:
```
🚨 TradePulse Alert: [STANDARD] from Marcus Reid (+447700900789). Issue: Radiator leaking in Barking. Location: IG11 (NON-COVERAGE). Tap to call back: tel:+447700900789
```

---

## 6. Verifying UK GDPR Retention in Supabase

1. Open your Supabase SQL editor.
2. Verify that records inserted have an `expires_at` column set to exactly 30 days in the future:
   ```sql
   SELECT call_id, created_at, expires_at FROM public.call_logs;
   ```
3. Test the automated log purging function:
   ```sql
   SELECT public.purge_expired_call_logs();
   ```
4. Confirm Row-Level Security is active:
   ```sql
   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
   ```
