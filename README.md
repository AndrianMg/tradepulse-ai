# 🚨 TradePulse AI

[![CI Pipeline](https://github.com/USER/tradepulse-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/USER/tradepulse-ai/actions)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-22+-green?logo=node.js)
![Fastify](https://img.shields.io/badge/Fastify-4.28-black?logo=fastify)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)
![Twilio](https://img.shields.io/badge/Twilio-Programmable%20SMS-F22F46?logo=twilio)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

> **Automated Inbound Voice Triage & Emergency Lead Recovery System for Romford Trade Contractors (RM1–RM7)**

---

## 📖 Overview

TradePulse AI is an automated telephony and webhook backend designed for independent trade contractors (plumbers, heating engineers, electricians, roofers) in Romford, Greater London.

When a customer calls a contractor's local virtual number (`01708`), the call is answered by an AI voice receptionist ("Debbie"). The voice agent:
1. **Triages Urgency**: Identifies active emergencies (burst pipes, gas leaks, winter boiler failures) vs standard quotes.
2. **Validates Coverage**: Verifies Romford postal codes (**RM1 through RM7**).
3. **Dispatches Alerts**: Formats and triggers instant click-to-call SMS alerts via Twilio to the on-call contractor.
4. **Maintains GDPR Compliance**: Safely records call logs with strict Row-Level Security (RLS) and automated 30-day log purging.

---

## 🏗️ Architecture

```
[Inbound Call (01708)] ──> [Twilio Trunk]
                                │
                                ▼
                     [Vapi / Retell AI Agent]
                     ("Debbie" - East London Receptionist)
                                │
                                ▼ [POST /api/vapi/webhook]
                     [Fastify Webhook Engine]
                      ├── 1. Zod Payload Validation
                      ├── 2. RM1–RM7 Postcode Boundary Check
                      ├── 3. Idempotency Check (call_id)
                      ├── 4. Twilio SMS Dispatch
                      └── 5. Supabase Multi-Tenant Logging
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Fill in your Supabase, Twilio, and Vapi secrets
```

### 3. Run Automated Tests
```bash
npm test
```

### 4. Start Development Server
```bash
npm run dev
```

---

## 📜 Database Schema & GDPR Retention
Database tables, Row-Level Security policies, and 30-day automated log retention functions are defined in `schema.sql`.

---

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
