# Facebook Conversions API Integration

This document describes the Facebook Conversions API (CAPI) integration for server-side event tracking in My Social Autopilot.

## Overview

The Facebook Conversions API allows you to share key web events directly from your server to Facebook's servers. This provides several benefits:

- **Improved data quality**: Server-side events are more reliable than browser-based tracking
- **Better attribution**: Events are tracked even when browser cookies are blocked
- **Enhanced matching**: Additional user data improves event matching to Facebook accounts
- **Privacy-compliant**: SHA256 hashing of PII before transmission

## Architecture

```
Client App (React)  -->  Server API (Express)  -->  Facebook CAPI
       |                       |                         |
       v                       v                         v
 fbc/fbp cookies        marketing_events          Event delivery
 (browser ID)           (event log)               confirmation
```

## Configuration

### Admin Settings

Navigate to **Admin > Integrations > Facebook Dataset** to configure:

1. **Dataset ID**: Your Meta Events Manager Dataset ID (found in Events Manager > Data Sources)
2. **Access Token**: Generated from Meta Business Settings
3. **Test Event Code**: Optional, for testing in Events Manager

### Generating an Access Token

1. Go to [Meta Business Settings](https://business.facebook.com/settings/)
2. Navigate to **Users > System Users**
3. Create a System User (if not exists)
4. Add the `events_management` permission
5. Generate a token with the following permissions:
   - `events_management`
   - `ads_management` (optional, for ad optimization)

## Event Types

### Standard Events Tracked

| Event Name | Trigger | Description |
|------------|---------|-------------|
| `PageView` | Page navigation | General page view tracking |
| `ViewContent` | Post view | User views a generated post |
| `Lead` | Brand onboarding | User completes brand setup |
| `CompleteRegistration` | Signup | New user registration |
| `Purchase` | Payment | Credit purchase or subscription |
| `InitiateCheckout` | Payment dialog | User opens credit purchase dialog |
| `generate` | Content generation | AI content generated |
| `edit` | Content edit | AI content edited |

## User Data Matching

The following user data fields are sent (SHA256 hashed) for improved matching:

| Field | Source | Required |
|-------|--------|----------|
| `em` (email) | User email | Recommended |
| `ph` (phone) | Brand/Profile | Optional |
| `fn` (first name) | Brand/Profile | Optional |
| `ln` (last name) | Brand/Profile | Optional |
| `ct` (city) | Brand/Profile | Optional |
| `st` (state) | Brand/Profile | Optional |
| `country` | Brand/Profile | Optional |
| `zp` (zip) | Brand/Profile | Optional |
| `external_id` | User ID | Recommended |
| `fbc` (click ID) | Cookie/URL | Recommended |
| `fbp` (browser ID) | Cookie | Recommended |
| `client_ip_address` | Request | Required |
| `client_user_agent` | Request | Required |

## Event Deduplication

### How Deduplication Works

Events are deduplicated using the `event_key` field:

1. **Server-side**: The `marketing_events` table has a unique constraint on `event_key`
2. **Facebook-side**: The `event_id` field is sent to Facebook for their deduplication

### Event Key Format

```
{event_type}:{unique_identifier}
```

Examples:
- `signup:user-uuid` - User registration
- `purchase:payment-intent-id` - Credit purchase
- `view:post-id:user-id` - Post view
- `generate:post-id` - Content generation

### Best Practices

1. **Always use event keys** - Every trackMarketingEvent call should include an event_key
2. **Use consistent formats** - Keep the event key format consistent across events
3. **Include transaction IDs** - For purchase events, use the payment intent or session ID
4. **Test deduplication** - Verify duplicate events are properly handled

## Client-Side Integration

### Capturing fbc/fbp

```typescript
import { getFacebookTrackingParams, trackViewContentEvent } from "@/lib/marketing";

// Get tracking params (fbc from URL fbclid, fbp from cookie)
const { fbc, fbp } = getFacebookTrackingParams();

// Track post view
trackViewContentEvent({
  post_id: "post-uuid",
  content_type: "image",
  content_name: "Generated Post",
});
```

### Available Functions

| Function | Purpose |
|----------|---------|
| `getFacebookClickId()` | Get fbc from URL parameter or cookie |
| `getFacebookBrowserId()` | Get or create fbp cookie |
| `getFacebookTrackingParams()` | Get both fbc and fbp |
| `trackViewContentEvent()` | Track post view event |
| `trackLeadEvent()` | Track lead/onboarding event |
| `trackInitiateCheckoutEvent()` | Track checkout initiation |

## Server-Side API

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/marketing/view-content` | POST | Track ViewContent event |
| `/api/marketing/lead` | POST | Track Lead event |
| `/api/marketing/initiate-checkout` | POST | Track InitiateCheckout event |
| `/api/admin/facebook-dataset` | GET | Get integration settings |
| `/api/admin/facebook-dataset` | PUT | Save integration settings |
| `/api/admin/facebook-dataset/test` | POST | Test connection |
| `/api/admin/marketing-events` | GET | List tracked events |

### Example Request

```typescript
// Server-side tracking
await trackMarketingEvent({
  event_name: "Purchase",
  event_key: `purchase:${paymentIntentId}`,
  event_source: "stripe",
  user_id: user.id,
  email: user.email,
  user_data: {
    phone: profile.phone,
    first_name: brand.contact_name,
  },
  value: 19.99,
  currency: "USD",
  event_payload: {
    type: "credit_purchase",
    credits: 100,
  },
});
```

## Testing

### Using Test Event Code

1. Enter a Test Event Code in Admin > Integrations > Facebook Dataset
2. Trigger events (signup, purchase, etc.)
3. View events in Meta Events Manager under Test Events tab
4. Remove Test Event Code for production

### Debugging

Check the `marketing_events` table for event status:

```sql
SELECT 
  event_name, 
  facebook_status, 
  facebook_response, 
  created_at 
FROM marketing_events 
ORDER BY created_at DESC 
LIMIT 20;
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Events not appearing | Invalid access token | Regenerate token |
| Low match rate | Missing user data | Add email, phone |
| Duplicate events | Missing event_key | Add unique event keys |
| Test events not showing | Wrong test code | Verify code in Events Manager |

## Privacy Considerations

- All PII is SHA256 hashed before transmission
- User data is only sent when user is authenticated
- IP addresses and user agents are transmitted unhashed (required by Facebook)
- Users can opt out via cookie consent mechanisms
- Event data is stored in `marketing_events` table for audit purposes

## Related Documentation

- [Meta Conversions API Documentation](https://developers.facebook.com/docs/marketing-api/conversions-api)
- [Meta Events Manager](https://business.facebook.com/events_manager)
- [Server-Side Event Best Practices](https://www.facebook.com/business/help/204210392587096)
