import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import {
  VapiEndOfCallPayloadSchema,
  RetellCallEndedPayloadSchema,
  NormalizedTriageResult,
} from './types/vapi';
import { validateRomfordPostcode } from './utils/postcode';
import { smsService } from './services/sms';
import { databaseService } from './services/supabase';

dotenv.config();

const app: FastifyInstance = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

// Enable CORS
app.register(cors, { origin: true });

// Health check endpoint
app.get('/health', async () => {
  return {
    status: 'ok',
    service: 'TradePulse AI Webhook Ingestion',
    timestamp: new Date().toISOString(),
    region: 'Romford (RM1-RM7)',
  };
});

// Webhook GET verification (some providers send a GET ping upon URL registration)
app.get('/api/vapi/webhook', async () => {
  return { status: 'ready', endpoint: 'TradePulse AI Vapi/Retell Webhook' };
});
// Words that suggest an emergency, used only when the agent did not capture the emergency flag
// (for example, the caller hung up or the line dropped). Leaning towards EMERGENCY is deliberate:
// a false alarm costs a phone call, a missed emergency costs a flooded house.
const EMERGENCY_HINTS =
  /\b(emergency|urgent|burst|flood(?:ing|ed)?|leak(?:ing)?|gas (?:leak|smell)|smell (?:of )?gas|water (?:coming|pouring) through|no heat(?:ing)?|sparking)\b/i;

function resolveEmergency(flag: unknown, ...context: (string | undefined)[]): boolean {
  if (flag !== undefined && flag !== null && flag !== '') {
    return flag === true || flag === 'true' || flag === 'yes';
  }
  return EMERGENCY_HINTS.test(context.filter(Boolean).join(' '));
}
/**
 * Normalizes incoming payload from Vapi or Retell into a clean internal triage structure
 */
function extractTriageData(body: any): NormalizedTriageResult | null {
  // 1. Try Vapi End-of-Call Payload
  const vapiParse = VapiEndOfCallPayloadSchema.safeParse(body);
  if (vapiParse.success) {
    const { call, analysis, transcript } = vapiParse.data.message;
    const structured = analysis?.structuredData || {};

    const callerPhone =
      structured.caller_phone ||
      call.customer?.number ||
      '';

    const callerName =
      structured.caller_name ||
      call.customer?.name ||
      'Caller (Name uncaptured)';

    const isEmergency = resolveEmergency(structured.emergency, analysis?.summary, transcript);

    const issueDescription =
      structured.issue_description ||
      analysis?.summary ||
      (transcript ? `Call summary: ${transcript.slice(0, 150)}...` : 'Incomplete transcript - please review recording');

    const rawPostcode =
      structured.postcode ||
      analysis?.summary ||
      transcript ||
      '';

    const postcodeResult = validateRomfordPostcode(rawPostcode);

    return {
      callId: call.id,
      assistantId: call.assistantId || '',
      callerPhone,
      callerName,
      emergency: isEmergency,
      issueDescription,
      rawPostcode: structured.postcode || '',
      validatedPostcode: postcodeResult.normalizedPostcode,
      isInCoverage: postcodeResult.isInCoverage,
      durationSeconds: call.durationSeconds || 0,
      recordingUrl: call.recordingUrl || null,
      transcript: transcript || '',
      rawPayload: body,
    };
  }

  // 2. Try Retell AI Payload
  const retellParse = RetellCallEndedPayloadSchema.safeParse(body);
  if (retellParse.success) {
    const { call } = retellParse.data;
    const custom = call.call_analysis?.custom_analysis_data || {};

    const callerPhone = custom.caller_phone || call.from_number || '';
    const callerName = custom.caller_name || 'Caller (Name uncaptured)';
     const isEmergency = resolveEmergency(
      custom.emergency,
      call.call_analysis?.call_summary,
      call.transcript,
    );
    const issueDescription =
      custom.issue_description ||
      call.call_analysis?.call_summary ||
      'Incomplete transcript - please review recording';

    const rawPostcode = custom.postcode || call.transcript || '';
    const postcodeResult = validateRomfordPostcode(rawPostcode);

    return {
      callId: call.call_id,
      assistantId: call.agent_id || '',
      callerPhone,
      callerName,
      emergency: isEmergency,
      issueDescription,
      rawPostcode: custom.postcode || '',
      validatedPostcode: postcodeResult.normalizedPostcode,
      isInCoverage: postcodeResult.isInCoverage,
      durationSeconds: Math.round((call.duration_ms || 0) / 1000),
      recordingUrl: call.recording_url || null,
      transcript: call.transcript || '',
      rawPayload: body,
    };
  }

  // 3. Fallback Generic Payload Handler (lenient extraction for mock or alternative webhooks)
  if (body && typeof body === 'object') {
    const callId = body.callId || body.id || body.call_id || `manual_${Date.now()}`;
    const callerPhone = body.caller_phone || body.callerPhone || body.phone || body.from || '';
    const callerName = body.caller_name || body.callerName || body.name || 'Caller (Name uncaptured)';
    const emergency = body.emergency === true || body.emergency === 'true' || false;
    const issueDescription = body.issue_description || body.issue || body.summary || 'Trade assistance requested';
    const rawPostcode = body.postcode || body.location || '';
    const postcodeResult = validateRomfordPostcode(rawPostcode);

    return {
      callId,
      assistantId: body.assistantId || body.assistant_id || '',
      callerPhone,
      callerName,
      emergency,
      issueDescription,
      rawPostcode,
      validatedPostcode: postcodeResult.normalizedPostcode,
      isInCoverage: postcodeResult.isInCoverage,
      durationSeconds: body.durationSeconds || body.duration || 0,
      recordingUrl: body.recordingUrl || body.recording_url || null,
      transcript: body.transcript || '',
      rawPayload: body,
    };
  }

  return null;
}

/**
 * Main Webhook Handler: POST /api/vapi/webhook
 */
app.post('/api/vapi/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
  const startTime = Date.now();
  const rawBody = request.body;

  // Optional Shared Secret Validation
  const sharedSecret = process.env.WEBHOOK_SHARED_SECRET;
  if (sharedSecret) {
    const authHeader = (request.headers['x-vapi-secret'] || request.headers['authorization']) as string;
    if (authHeader !== sharedSecret && authHeader !== `Bearer ${sharedSecret}`) {
      app.log.warn('Unauthorized webhook request received');
      return reply.status(401).send({ error: 'Unauthorized: Invalid secret header' });
    }
  }

  // Extract structured triage fields
  const triage = extractTriageData(rawBody);

  if (!triage) {
    app.log.error('Failed to parse or normalize voice agent webhook payload');
    return reply.status(400).send({
      error: 'Invalid payload structure',
      details: 'Unable to extract callId or caller metadata from payload',
    });
  }

  app.log.info({
    event: 'voice_call_received',
    callId: triage.callId,
    emergency: triage.emergency,
    postcode: triage.validatedPostcode,
    inCoverage: triage.isInCoverage,
  });

  // STEP 1: Idempotency Check
  const alreadyProcessed = await databaseService.isCallProcessed(triage.callId);
  if (alreadyProcessed) {
    app.log.info(`Idempotent skip: Call ID ${triage.callId} has already been alerted and saved.`);
    return reply.status(200).send({
      status: 'success',
      action: 'ignored_duplicate',
      callId: triage.callId,
      message: 'Webhook previously processed and recorded.',
    });
  }

  // STEP 2: Lookup Contractor profile
  const contractor = await databaseService.getContractor(triage.assistantId);
  if (!contractor) {
    app.log.error(`No contractor found for assistant ID: ${triage.assistantId}`);
    return reply.status(404).send({ error: 'Contractor record not found' });
  }

  // STEP 3: Dispatch Instant SMS Alert via Twilio
  // Format location label: if out of coverage, tag it clearly
  const locationLabel = triage.isInCoverage
    ? triage.validatedPostcode || 'RM Area'
    : `${triage.validatedPostcode || 'Out of Area'} (NON-COVERAGE)`;

  const smsResult = await smsService.sendContractorAlert({
    contractorPhone: contractor.notification_phone,
    twilioPhone: contractor.twilio_phone_number,
    isEmergency: triage.emergency,
    callerName: triage.callerName,
    callerPhone: triage.callerPhone,
    issueSummary: triage.issueDescription,
    postcode: locationLabel,
  });

  // STEP 4: Store Lead Record in Supabase
  const leadResult = await databaseService.createLead({
    contractorId: contractor.id,
    callId: triage.callId,
    callerName: triage.callerName,
    callerPhone: triage.callerPhone,
    emergency: triage.emergency,
    issueDescription: triage.issueDescription,
    postcode: triage.validatedPostcode || triage.rawPostcode,
    isInCoverage: triage.isInCoverage,
    smsSid: smsResult.sid,
  });

  // STEP 5: Store Call Logs & GDPR Retention Telemetry
  await databaseService.saveCallLog({
    contractorId: contractor.id,
    callId: triage.callId,
    durationSeconds: triage.durationSeconds,
    recordingUrl: triage.recordingUrl,
    transcript: triage.transcript,
    rawPayload: triage.rawPayload,
    callStatus: 'completed',
  });

  const durationMs = Date.now() - startTime;
  app.log.info(`Triage handled successfully in ${durationMs}ms for call ${triage.callId}`);

  return reply.status(200).send({
    status: 'success',
    callId: triage.callId,
    emergency: triage.emergency,
    postcode: triage.validatedPostcode,
    inCoverage: triage.isInCoverage,
    smsDispatched: smsResult.success,
    smsSid: smsResult.sid,
    leadId: leadResult.leadId,
    processingTimeMs: durationMs,
  });
});

/**
 * Start the Fastify Server
 */
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

export async function startServer() {
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`🚀 TradePulse AI Webhook Server listening on http://${HOST}:${PORT}`);
    console.log(`📡 Webhook Endpoint: http://${HOST}:${PORT}/api/vapi/webhook`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Auto-start server when run directly
if (require.main === module) {
  startServer();
}

export default app;
