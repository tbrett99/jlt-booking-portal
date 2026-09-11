# Orbit Holiday Showcase API

## Purpose

Orbit can send a **single, public-only itinerary snapshot** to the JLT Portal after an agent chooses **Create public showcase**. The Portal permanently owns the received content and never requests live quote data, pricing, availability, or images from Orbit afterwards.

> A changed itinerary must be sent as a new showcase with a new `externalPublicationId`. It is not an update to an existing public snapshot.

## Endpoint

```text
POST https://portal.thejltgroup.co.uk/api/external/quote-showcases
X-API-Key: <existing JLT integration API key>
Content-Type: application/json
```

The endpoint uses the established Portal `X-API-Key` convention. The `agentId` is matched to the existing CRM `uniqueAgentId`, for example `JLT-12345`.

## Required rules before Orbit sends

The agent must have an **approved, live Portal public profile**. Orbit should use the existing JLT agent identifier rather than an email address. Orbit must never send client information, booking references, supplier credentials, price breakdowns, cost prices, commission, margin, rates, availability, or live quote links.

Only images marked `supplier` or `agent_upload` are accepted. Image URLs must use HTTPS and cannot be Google-hosted. Where Orbit has no permitted image, omit the image and the Portal will apply its JLT fallback visual.

## Request body

```json
{
  "agentId": "JLT-12345",
  "externalPublicationId": "1ea89898-9715-48ec-bebe-a6c5e56165bc",
  "title": "New York and Finger Lakes Escape",
  "summary": "A hand-picked itinerary designed to inspire a thoughtful travel conversation.",
  "destination": "New York and Finger Lakes",
  "travelPeriodLabel": "Autumn 2026",
  "durationNights": 7,
  "price": {
    "mode": "from",
    "amount": 1495,
    "currency": "GBP",
    "perPerson": true
  },
  "heroImage": {
    "url": "https://supplier-cdn.example.com/new-york-hero.jpg",
    "source": "supplier"
  },
  "itinerary": [
    {
      "day": 1,
      "title": "Arrive in New York",
      "description": "Arrive and settle into your chosen hotel.",
      "highlights": ["Private airport transfer"]
    }
  ],
  "accommodationOptions": [
    {
      "name": "Example Hotel",
      "location": "Manhattan",
      "room": "Deluxe King",
      "board": "Room only",
      "description": "Optional public accommodation description.",
      "image": {
        "url": "https://supplier-cdn.example.com/example-hotel.jpg",
        "source": "supplier"
      }
    }
  ],
  "inclusions": ["Selected accommodation", "Private airport transfer"],
  "practicalNotes": ["Subject to availability at the point of enquiry"],
  "enquiryContext": {
    "showcaseId": "1ea89898-9715-48ec-bebe-a6c5e56165bc"
  }
}
```

All accepted fields are public-facing. The API rejects unknown fields rather than silently retaining them.

## Response contract

```json
{
  "success": true,
  "showcaseId": 702,
  "publicUrl": "https://www.thejltgroup.co.uk/travel-agents/example-agent/holiday-showcases/new-york-and-finger-lakes-escape-ab12cde"
}
```

Orbit should keep `externalPublicationId` and treat a repeated request with the same value as successful. The Portal returns the original `showcaseId` and `publicUrl` without creating a duplicate.

| Status | Meaning | Required Orbit behaviour |
|---|---|---|
| `201` | Snapshot received and stored. | Show the returned public URL to the agent. |
| `200` | Identical external publication already received. | Treat as success; use the returned original URL. |
| `400` | Invalid or non-public payload. | Do not retry until the payload has been corrected. |
| `401` | API key missing, invalid, or inactive. | Stop and report integration authentication failure. |
| `404` | JLT agent identifier not found. | Stop and ask the agent to verify their Portal profile/identifier. |
| `409` | Agent is not eligible or has no approved live public profile. | Do not publish; the agent must resolve their Portal profile first. |
| `503` / `500` | Temporary Portal error. | Retry with the same `externalPublicationId`; the endpoint is idempotent. |

## What happens after receipt

The received snapshot appears in the agent’s Portal at **My Public Profile → Manage My Holiday Showcases**. The agent can publish, hide, reorder, set an expiry date, or remove it. Deletion is a soft-delete so the Portal retains an audit record and a future repeated Orbit delivery does not unexpectedly recreate the removed public display.

Public display is additionally gated by the agent’s JLT public profile. If an ordinary agent is no longer Active, is In Contract, suspended, in notice, paused, cancelled, or has their public profile hidden, their showcases are not publicly rendered. A consumer enquiry from a showcase page is stored with the Portal showcase ID and delivered only to the agent’s approved private enquiry address.
