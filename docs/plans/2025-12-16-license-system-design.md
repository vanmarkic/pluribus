# License System Design

**Date:** 2025-12-16
**Issue:** #39
**Status:** Draft

## Summary

Self-hosted license validation system with Stripe payments. Target: 500 seats at 1€/month or 10€/year.

## Decisions

| Aspect | Decision |
|--------|----------|
| Backend | Self-hosted on Hetzner VPS (SQLite + Node.js) |
| Payment | Stripe |
| Pricing | 1€/month or 10€/year (2 months free) |
| VAT | Handled by accountant + automated invoicing |
| Trial | None (price is low enough) |
| Devices | 1 device per license, auto-swap with warning |
| Grace period | 7 days after expiry, then read-only mode |
| Key format | `PLRB-XXXX-XXXX-XXXX` |
| Offline | 24h JWT cache, 7-day grace if network fails |
| Machine ID | Hashed hardware UUID (macOS IOPlatformUUID) |

## Architecture

```
┌─────────────────┐         ┌─────────────────────┐
│  Pluribus App   │ ←────── │  Hetzner VPS        │
│  (Electron)     │         │  (License Server)   │
└────────┬────────┘         └──────────┬──────────┘
         │                             │
         │  POST /api/license/validate │
         │  {key, machineId}           │
         │ ───────────────────────────►│
         │                             │
         │  {valid, expiresAt, jwt}    │
         │ ◄───────────────────────────│
         │                             │
         └─────────────────────────────┘

┌─────────────────┐         ┌─────────────────────┐
│  Stripe         │ ←────── │  License Server     │
│  (Payments)     │ webhook │  (Creates license)  │
└─────────────────┘         └─────────────────────┘
```

**Flow:**
1. User buys on Stripe → Webhook creates license on VPS
2. User receives license key via email/invoice
3. User enters key in app → App validates with server
4. Server returns signed JWT (24h TTL) → App caches locally
5. App re-validates every 24h (or uses cache if offline)

## Database Schema

```sql
-- Licenses table
CREATE TABLE licenses (
  id TEXT PRIMARY KEY,                    -- PLRB-XXXX-XXXX-XXXX
  email TEXT NOT NULL,                    -- Customer email
  stripe_customer_id TEXT,                -- Stripe reference
  stripe_subscription_id TEXT,            -- For cancellation sync
  status TEXT DEFAULT 'active',           -- active, expired, cancelled
  plan TEXT DEFAULT 'monthly',            -- monthly, annual
  machine_id TEXT,                        -- Hashed hardware UUID (1 device)
  activated_at DATETIME,                  -- When device was linked
  expires_at DATETIME NOT NULL,           -- Subscription end date
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Validation log (analytics/debugging)
CREATE TABLE validation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT REFERENCES licenses(id),
  machine_id TEXT,
  result TEXT,                            -- valid, expired, wrong_machine, not_found
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

### POST /api/license/validate

Validates a license key and activates on machine.

**Request:**
```json
{
  "key": "PLRB-XXXX-XXXX-XXXX",
  "machineId": "sha256-hashed-hardware-uuid"
}
```

**Responses:**

Success:
```json
{
  "valid": true,
  "expiresAt": "2026-01-15T00:00:00Z",
  "token": "eyJhbGciOiJFUzI1NiIs..."
}
```

Device changed (warning, still valid):
```json
{
  "valid": true,
  "warning": "device_changed",
  "message": "License moved to this device. You cannot switch back.",
  "expiresAt": "2026-01-15T00:00:00Z",
  "token": "eyJhbGciOiJFUzI1NiIs..."
}
```

Invalid:
```json
{
  "valid": false,
  "reason": "expired" | "wrong_machine" | "not_found"
}
```

### POST /api/stripe/webhook

Handles Stripe events:
- `checkout.session.completed` → Create license, email key to customer
- `invoice.paid` → Extend `expires_at` by subscription period
- `customer.subscription.deleted` → Set `status = 'cancelled'`

## JWT Token

**Contents:**
```json
{
  "sub": "PLRB-XXXX-XXXX-XXXX",
  "machineId": "sha256-hashed-uuid",
  "exp": 1734567890,
  "iat": 1734481490
}
```

**Signing:** ES256 (ECDSA with P-256 curve)
- Private key: On server only
- Public key: Embedded in app for local verification

## App-Side Implementation

### New Adapter

`src/adapters/license/index.ts`

```typescript
export type LicenseStatus =
  | { valid: true; expiresAt: Date }
  | { valid: false; reason: 'expired' | 'wrong_machine' | 'not_found' | 'network_error' }
  | { valid: true; warning: 'device_changed'; expiresAt: Date };

export type LicenseAdapter = {
  getMachineId: () => Promise<string>;
  validate: (key: string) => Promise<LicenseStatus>;
  getCachedStatus: () => LicenseStatus | null;
  clearCache: () => void;
};
```

### Storage

- License key → OS Keychain (secure, like email passwords)
- Cached JWT → electron-store config

### Startup Flow

```
1. Check for cached JWT in config
2. If JWT valid (signature OK, not expired) → proceed normally
3. If JWT expired or missing:
   a. Retrieve license key from keychain
   b. Call server to revalidate
   c. On success → cache new JWT, proceed
   d. On network failure:
      - If cache < 7 days old → grace period, proceed
      - If cache > 7 days old → read-only mode
4. If no license key stored → show activation screen
```

### Read-Only Mode

When license is invalid/expired:
- Can read existing emails
- Cannot sync new emails
- Cannot compose/send
- Cannot use AI features
- Shows banner with renewal link

## UI Changes

### License Activation Screen

Shown when no valid license is found.

```
┌─────────────────────────────────────────┐
│                                         │
│         🔐 Activate Pluribus            │
│                                         │
│  Enter your license key:                │
│  ┌─────────────────────────────────┐    │
│  │ PLRB-                           │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [Activate]                             │
│                                         │
│  ─────────────────────────────────────  │
│  Don't have a license?                  │
│  [Buy License - 1€/month]               │
│                                         │
└─────────────────────────────────────────┘
```

### Settings → License Section

- License status (Active/Expired)
- Expiry date
- Masked key (PLRB-XXXX-XXXX-7890)
- "Change License Key" button

### Read-Only Mode Banner

```
⚠️ License expired. Renew to sync and send emails. [Renew Now]
```

## Security Model

**"Speed bump" security** - Makes piracy inconvenient without annoying legitimate users.

| Threat | Mitigation |
|--------|------------|
| Key sharing | 1 machine per license, auto-swap with no return |
| Code patching | Basic obfuscation, integrity checks (not bulletproof) |
| API spoofing | JWT signature verification with embedded public key |
| Offline bypass | 7-day grace max, then read-only |

## License Key Generation

Format: `PLRB-XXXX-XXXX-XXXX`

```typescript
function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/1/I confusion
  const segments = [];
  for (let i = 0; i < 3; i++) {
    let segment = '';
    for (let j = 0; j < 4; j++) {
      segment += chars[crypto.randomInt(chars.length)];
    }
    segments.push(segment);
  }
  return `PLRB-${segments.join('-')}`;
}
```

## Machine ID Generation

```typescript
import { execSync } from 'child_process';
import crypto from 'crypto';

function getMachineId(): string {
  // macOS: Get hardware UUID
  const output = execSync(
    'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID'
  ).toString();
  const uuid = output.match(/"IOPlatformUUID" = "([^"]+)"/)?.[1];

  if (!uuid) throw new Error('Could not get machine ID');

  // Hash for privacy
  return crypto.createHash('sha256').update(uuid).digest('hex');
}
```

## Out of Scope (Future)

- Admin dashboard for license management
- Multi-seat/team licenses
- Automated refunds
- Windows/Linux support (macOS only initially)

## Stripe Products Setup

Create in Stripe Dashboard:
- Product: "Pluribus Mail"
- Price 1: 1€/month recurring
- Price 2: 10€/year recurring (2 months free)
- Checkout: Collect email, redirect to success page with instructions
