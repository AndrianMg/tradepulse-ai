import twilio from 'twilio';

export interface DispatchSmsParams {
  contractorPhone: string;
  twilioPhone: string;
  isEmergency: boolean;
  callerName: string;
  callerPhone: string;
  issueSummary: string;
  postcode: string;
}

export interface SmsDispatchResult {
  success: boolean;
  sid?: string;
  messageBody: string;
  error?: string;
}

/**
 * Normalizes phone numbers to standard E.164 UK format (+44...)
 */
export function formatE164UK(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9+]/g, '');

  // If starts with 07 or 01, replace leading 0 with +44
  if (cleaned.startsWith('0')) {
    cleaned = '+44' + cleaned.substring(1);
  } else if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }

  return cleaned;
}

/**
 * Formats the TradePulse alert message according to the strict specification:
 * "🚨 TradePulse Alert: [EMERGENCY/STANDARD] from [Name] ([Phone]). Issue: [Summary]. Location: [Postcode]. Tap to call back: [tel link]"
 */
export function buildAlertMessageBody(params: {
  isEmergency: boolean;
  callerName: string;
  callerPhone: string;
  issueSummary: string;
  postcode: string;
}): string {
  const alertLevel = params.isEmergency ? 'EMERGENCY' : 'STANDARD';
  const name = params.callerName.trim() || 'Caller';
  const rawPhone = params.callerPhone.trim();
  const e164Phone = formatE164UK(rawPhone);
  const summary = params.issueSummary.trim() || 'Urgent callback requested';
  const location = params.postcode.trim() || 'RM Area Unconfirmed';

  // Format clickable tel link
  const telLink = `tel:${e164Phone || rawPhone}`;

  return `🚨 TradePulse Alert: [${alertLevel}] from ${name} (${e164Phone || rawPhone}). Issue: ${summary}. Location: ${location}. Tap to call back: ${telLink}`;
}

export class SmsService {
  private client: twilio.Twilio | null = null;
  private accountSid: string;
  private authToken: string;
  private defaultTwilioPhone: string;

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    this.authToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.defaultTwilioPhone = process.env.TWILIO_PHONE_NUMBER || '';

    // Initialize Twilio client if credentials are configured
    if (this.accountSid && this.accountSid.startsWith('AC') && this.authToken) {
      try {
        this.client = twilio(this.accountSid, this.authToken);
      } catch (err) {
        console.warn('⚠️ Twilio client initialization failed. Operating in mock/dry-run mode.');
      }
    } else {
      console.warn('⚠️ TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set. Running in dry-run simulation mode.');
    }
  }

  /**
   * Dispatches instant SMS to contractor mobile
   */
  async sendContractorAlert(params: DispatchSmsParams): Promise<SmsDispatchResult> {
    const messageBody = buildAlertMessageBody({
      isEmergency: params.isEmergency,
      callerName: params.callerName,
      callerPhone: params.callerPhone,
      issueSummary: params.issueSummary,
      postcode: params.postcode,
    });

    const toPhone = formatE164UK(params.contractorPhone);
    const fromPhone = formatE164UK(params.twilioPhone || this.defaultTwilioPhone);

    // If client is in mock / dry-run mode (local testing without live Twilio account)
    if (!this.client || this.accountSid.includes('XXXXX')) {
      console.log(`[DRY-RUN SMS DISPATCH]`);
      console.log(`  To: ${toPhone}`);
      console.log(`  From: ${fromPhone}`);
      console.log(`  Body: ${messageBody}`);

      return {
        success: true,
        sid: `SM_MOCK_${Date.now()}`,
        messageBody,
      };
    }

    try {
      const response = await this.client.messages.create({
        to: toPhone,
        from: fromPhone,
        body: messageBody,
      });

      console.log(`✅ Twilio SMS dispatched successfully! SID: ${response.sid} (To: ${toPhone})`);
      return {
        success: true,
        sid: response.sid,
        messageBody,
      };
    } catch (error: any) {
      console.error(`❌ Twilio SMS dispatch failed:`, error?.message || error);
      return {
        success: false,
        error: error?.message || 'Unknown Twilio dispatch error',
        messageBody,
      };
    }
  }
}

export const smsService = new SmsService();
