import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface ContractorRecord {
  id: string;
  business_name: string;
  trade_type: string;
  phone_number: string;
  notification_phone: string;
  twilio_phone_number: string;
  vapi_assistant_id: string;
  service_postcodes: string[];
}

export interface SaveLeadParams {
  contractorId: string;
  callId: string;
  callerName: string;
  callerPhone: string;
  emergency: boolean;
  issueDescription: string;
  postcode: string;
  isInCoverage: boolean;
  smsSid?: string;
}

export interface SaveCallLogParams {
  contractorId: string;
  callId: string;
  durationSeconds: number;
  recordingUrl: string | null;
  transcript: string;
  rawPayload: Record<string, unknown>;
  callStatus: string;
}

export class DatabaseService {
  private client: SupabaseClient | null = null;
  private isConfigured: boolean = false;

  // In-memory fallback cache for development/testing when Supabase is not yet connected
  private mockLeads: Map<string, any> = new Map();
  private mockCallLogs: Map<string, any> = new Map();

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey && !supabaseUrl.includes('your-project-id')) {
      try {
        this.client = createClient(supabaseUrl, serviceRoleKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });
        this.isConfigured = true;
        console.log('✅ Supabase client initialized with Service Role');
      } catch (err: any) {
        console.warn('⚠️ Supabase client initialization failed:', err?.message);
      }
    } else {
      console.warn('⚠️ Supabase credentials not configured in .env. Running with in-memory fallback store.');
    }
  }

  /**
   * Finds contractor linked to the Vapi assistant ID or Twilio inbound number
   */
  async getContractor(assistantId?: string, twilioNumber?: string): Promise<ContractorRecord | null> {
    if (this.isConfigured && this.client) {
      if (assistantId) {
        const { data, error } = await this.client
          .from('contractors')
          .select('*')
          .eq('vapi_assistant_id', assistantId)
          .eq('is_active', true)
          .maybeSingle();

        if (data && !error) return data as ContractorRecord;
      }

      if (twilioNumber) {
        const { data, error } = await this.client
          .from('contractors')
          .select('*')
          .eq('twilio_phone_number', twilioNumber)
          .eq('is_active', true)
          .maybeSingle();

        if (data && !error) return data as ContractorRecord;
      }

      // Fallback to primary active contractor
      const { data } = await this.client
        .from('contractors')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (data) return data as ContractorRecord;
    }

    // Default development fallback contractor for Romford
    return {
      id: '11111111-1111-1111-1111-111111111111',
      business_name: process.env.FALLBACK_CONTRACTOR_NAME || 'Romford Emergency Plumbing & Heating',
      trade_type: 'Plumbing & Gas Heating',
      phone_number: '+441708123456',
      notification_phone: process.env.FALLBACK_CONTRACTOR_PHONE || '+447911123456',
      twilio_phone_number: process.env.TWILIO_PHONE_NUMBER || '+441708999888',
      vapi_assistant_id: assistantId || 'asst_vapi_romford_001',
      service_postcodes: ['RM1', 'RM2', 'RM3', 'RM4', 'RM5', 'RM6', 'RM7'],
    };
  }

  /**
   * Idempotency Check: Verifies whether this call_id has already been processed
   */
  async isCallProcessed(callId: string): Promise<boolean> {
    if (this.isConfigured && this.client) {
      const { data, error } = await this.client
        .from('leads')
        .select('id')
        .eq('call_id', callId)
        .maybeSingle();

      if (error) {
        console.error('Error checking call idempotency:', error);
        return false;
      }
      return !!data;
    }

    return this.mockLeads.has(callId);
  }

  /**
   * Saves a new lead securely in Supabase
   */
  async createLead(params: SaveLeadParams): Promise<{ success: boolean; leadId?: string; isDuplicate?: boolean }> {
    // Idempotency check before write
    const alreadyProcessed = await this.isCallProcessed(params.callId);
    if (alreadyProcessed) {
      console.log(`ℹ️ Call ${params.callId} was already processed. Skipping duplicate lead creation.`);
      return { success: true, isDuplicate: true };
    }

    if (this.isConfigured && this.client) {
      const { data, error } = await this.client
        .from('leads')
        .insert({
          contractor_id: params.contractorId,
          call_id: params.callId,
          caller_name: params.callerName,
          caller_phone: params.callerPhone,
          emergency: params.emergency,
          issue_description: params.issueDescription,
          postcode: params.postcode,
          is_in_coverage: params.isInCoverage,
          status: 'dispatched',
          sms_sid: params.smsSid,
          sms_dispatched_at: params.smsSid ? new Date().toISOString() : null,
        })
        .select('id')
        .single();

      if (error) {
        // If unique constraint on call_id fails, handle idempotency race condition
        if (error.code === '23505') {
          console.log(`ℹ️ Race condition idempotency caught on call_id ${params.callId}`);
          return { success: true, isDuplicate: true };
        }
        console.error('❌ Failed to insert lead into Supabase:', error);
        return { success: false };
      }

      return { success: true, leadId: data.id, isDuplicate: false };
    }

    // Fallback in-memory insertion
    const mockId = `lead_${Date.now()}`;
    this.mockLeads.set(params.callId, { id: mockId, ...params, created_at: new Date() });
    return { success: true, leadId: mockId, isDuplicate: false };
  }

  /**
   * Stores complete call metadata, raw payload, and GDPR retention timestamp
   */
  async saveCallLog(params: SaveCallLogParams): Promise<{ success: boolean }> {
    if (this.isConfigured && this.client) {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await this.client.from('call_logs').upsert(
        {
          call_id: params.callId,
          contractor_id: params.contractorId,
          duration_seconds: params.durationSeconds,
          recording_url: params.recordingUrl,
          transcript: params.transcript,
          raw_payload: params.rawPayload,
          call_status: params.callStatus,
          expires_at: expiresAt,
        },
        { onConflict: 'call_id' }
      );

      if (error) {
        console.error('❌ Failed to save call log in Supabase:', error);
        return { success: false };
      }
      return { success: true };
    }

    this.mockCallLogs.set(params.callId, { ...params, created_at: new Date() });
    return { success: true };
  }
}

export const databaseService = new DatabaseService();
