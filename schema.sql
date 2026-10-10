-- ============================================================================
-- TradePulse AI - Supabase Database Schema
-- Inbound Voice Triage & Lead Recovery System for Romford (RM1-RM7) Contractors
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. CONTRACTORS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.contractors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name TEXT NOT NULL,
    trade_type TEXT NOT NULL DEFAULT 'General Trade', -- Plumbing, Electrical, Roofing, etc.
    phone_number TEXT NOT NULL, -- Public customer-facing number
    notification_phone TEXT NOT NULL, -- Contractor mobile receiving SMS alerts (E.164)
    twilio_phone_number TEXT NOT NULL, -- Twilio virtual number provisioned for contractor
    vapi_assistant_id TEXT UNIQUE, -- Vapi/Retell assistant identifier linked to contractor
    service_postcodes TEXT[] NOT NULL DEFAULT ARRAY['RM1', 'RM2', 'RM3', 'RM4', 'RM5', 'RM6', 'RM7'],
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ============================================================================
-- 2. LEADS TABLE (Extracted Emergency & Service Jobs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contractor_id UUID NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
    call_id TEXT NOT NULL UNIQUE, -- Unique voice provider call identifier (Enforces Idempotency)
    caller_name TEXT NOT NULL DEFAULT 'Caller (Name uncaptured)',
    caller_phone TEXT NOT NULL, -- Caller phone number in E.164 format
    emergency BOOLEAN NOT NULL DEFAULT false,
    issue_description TEXT NOT NULL,
    postcode TEXT, -- Cleaned outward or full postcode (e.g., RM1 4AU, RM3)
    is_in_coverage BOOLEAN NOT NULL DEFAULT true, -- True if postcode within contractor coverage (RM1-RM7)
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'dispatched', 'contacted', 'completed', 'junk')),
    sms_dispatched_at TIMESTAMPTZ,
    sms_sid TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ============================================================================
-- 3. CALL_LOGS TABLE (Telemetry, Audio, & GDPR-Governed Transcripts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id TEXT NOT NULL UNIQUE, -- Corresponds to leads.call_id
    contractor_id UUID NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
    duration_seconds INTEGER DEFAULT 0,
    recording_url TEXT,
    transcript TEXT, -- Full voice transcript
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb, -- Raw Vapi/Retell webhook payload
    call_status TEXT NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc'::text, now()) + INTERVAL '30 days')
);

-- ============================================================================
-- 4. PERFORMANCE & IDEMPOTENCY INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_contractors_vapi_assistant_id ON public.contractors(vapi_assistant_id);
CREATE INDEX IF NOT EXISTS idx_contractors_twilio_number ON public.contractors(twilio_phone_number);
CREATE INDEX IF NOT EXISTS idx_leads_call_id ON public.leads(call_id);
CREATE INDEX IF NOT EXISTS idx_leads_contractor_id ON public.leads(contractor_id);
CREATE INDEX IF NOT EXISTS idx_leads_postcode ON public.leads(postcode);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_expires_at ON public.call_logs(expires_at);

-- ============================================================================
-- 5. UK GDPR COMPLIANCE & AUTOMATIC 30-DAY RETENTION PURGING
-- ============================================================================
-- Function to automatically purge call logs and audio references older than 30 days
CREATE OR REPLACE FUNCTION public.purge_expired_call_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete call logs past their 30-day expiration date
    DELETE FROM public.call_logs
    WHERE expires_at < timezone('utc'::text, now());
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Anonymize lead caller details older than 90 days for GDPR right to erasure (optional)
    UPDATE public.leads
    SET 
        caller_name = 'GDPR Anonymized',
        caller_phone = '+440000000000',
        issue_description = '[Transcript/description purged per data retention policy]'
    WHERE created_at < (timezone('utc'::text, now()) - INTERVAL '90 days')
      AND caller_name != 'GDPR Anonymized';

    RETURN deleted_count;
END;
$$;

-- Note: In Supabase, you can schedule this using pg_cron:
-- SELECT cron.schedule('purge-call-logs-daily', '0 3 * * *', 'SELECT public.purge_expired_call_logs();');

-- Auto-update updated_at timestamp trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_contractors_updated_at
    BEFORE UPDATE ON public.contractors
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- Service Role (Backend Webhook Handler) has unrestricted access
CREATE POLICY "Service Role Full Access - Contractors"
    ON public.contractors
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service Role Full Access - Leads"
    ON public.leads
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service Role Full Access - Call Logs"
    ON public.call_logs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated Contractor Policies (Multi-tenant isolation)
-- Contractors can only view and update their own business records and leads
CREATE POLICY "Contractors can view own profile"
    ON public.contractors
    FOR SELECT
    TO authenticated
    USING (id = auth.uid());

CREATE POLICY "Contractors can view own leads"
    ON public.leads
    FOR SELECT
    TO authenticated
    USING (contractor_id = auth.uid());

CREATE POLICY "Contractors can update own lead status"
    ON public.leads
    FOR UPDATE
    TO authenticated
    USING (contractor_id = auth.uid())
    WITH CHECK (contractor_id = auth.uid());

CREATE POLICY "Contractors can view own call logs"
    ON public.call_logs
    FOR SELECT
    TO authenticated
    USING (contractor_id = auth.uid());

-- ============================================================================
-- 7. SEED DATA (For Local / Development Testing)
-- ============================================================================
INSERT INTO public.contractors (
    id,
    business_name,
    trade_type,
    phone_number,
    notification_phone,
    twilio_phone_number,
    vapi_assistant_id,
    service_postcodes
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'Romford Emergency Plumbing & Heating',
    'Plumbing & Gas Heating',
    '+441708123456', -- Local 01708 Romford virtual number
    '+447911123456', -- Contractor's direct mobile for instant SMS
    '+441708999888', -- Twilio number
    'asst_vapi_romford_001',
    ARRAY['RM1', 'RM2', 'RM3', 'RM4', 'RM5', 'RM6', 'RM7']
) ON CONFLICT (id) DO NOTHING;
