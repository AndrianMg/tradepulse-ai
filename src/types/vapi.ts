import { z } from 'zod';

/**
 * Structured triage information extracted by Vapi / Retell AI voice agent
 */
export const StructuredTriageDataSchema = z.object({
  caller_name: z.string().optional().default('Caller (Name uncaptured)'),
  caller_phone: z.string().optional(),
  emergency: z.union([z.boolean(), z.string().transform((v) => v === 'true' || v === 'yes')]).default(false),
  issue_description: z.string().optional().default('No description provided'),
  postcode: z.string().optional().default(''),
});

export type StructuredTriageData = z.infer<typeof StructuredTriageDataSchema>;

/**
 * Vapi End-of-Call Report Payload Schema
 * Handles Vapi standard server-side webhook event format
 */
export const VapiEndOfCallPayloadSchema = z.object({
  message: z.object({
    type: z.literal('end-of-call-report').or(z.string()),
    call: z.object({
      id: z.string(),
      assistantId: z.string().optional(),
      phoneNumberId: z.string().optional(),
      status: z.string().optional().default('completed'),
      durationSeconds: z.number().optional().default(0),
      recordingUrl: z.string().nullable().optional(),
      customer: z
        .object({
          number: z.string().optional(),
          name: z.string().optional(),
        })
        .optional(),
    }),
    analysis: z
      .object({
        summary: z.string().optional(),
        structuredData: z.record(z.string(), z.any()).optional(),
        successEvaluation: z.union([z.boolean(), z.string()]).optional(),
      })
      .optional(),
    transcript: z.string().optional().default(''),
    endedReason: z.string().optional(),
  }),
});

export type VapiEndOfCallPayload = z.infer<typeof VapiEndOfCallPayloadSchema>;

/**
 * Retell AI Call Ended Payload Schema (for dual Vapi/Retell support)
 */
export const RetellCallEndedPayloadSchema = z.object({
  event: z.literal('call_analyzed').or(z.literal('call_ended')),
  call: z.object({
    call_id: z.string(),
    agent_id: z.string().optional(),
    from_number: z.string().optional(),
    to_number: z.string().optional(),
    duration_ms: z.number().optional(),
    recording_url: z.string().nullable().optional(),
    transcript: z.string().optional().default(''),
    call_analysis: z
      .object({
        call_summary: z.string().optional(),
        custom_analysis_data: z.record(z.string(), z.any()).optional(),
      })
      .optional(),
  }),
});

export type RetellCallEndedPayload = z.infer<typeof RetellCallEndedPayloadSchema>;

/**
 * Unified Internal Triage Extraction Result
 */
export interface NormalizedTriageResult {
  callId: string;
  assistantId: string;
  callerPhone: string;
  callerName: string;
  emergency: boolean;
  issueDescription: string;
  rawPostcode: string;
  validatedPostcode: string | null;
  isInCoverage: boolean;
  durationSeconds: number;
  recordingUrl: string | null;
  transcript: string;
  rawPayload: Record<string, unknown>;
}
