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

The endpoint uses the established Portal `X-API-Key` convention. For standard agents, `agentId` is matched to the existing CRM `uniqueAgentId`, for example `JLT-12345`. An approved active Portal staff account with a live public profile may instead use its numeric Portal user ID. This exception is intentionally restricted to `admin` and `super_admin` accounts that do not have a CRM `uniqueAgentId`.

## Required rules before Orbit sends

The agent must have an **approved, live Portal public profile**. Orbit should use the existing JLT agent identifier rather than an email address. For an approved staff public profile with no CRM identifier, Orbit may send the numeric Portal user ID as a JSON number, for example `"agentId": 47`. Orbit must never send client information, booking references, supplier credentials, price breakdowns, cost prices, commission, margin, rates, availability, or live quote links.

Only images marked `supplier` or `agent_upload` are accepted. Image URLs must use HTTPS and cannot be Google-hosted. Where Orbit has no permitted hero image, omit `heroImage` and the Portal will apply its JLT fallback visual. The optional `itineraryImages` gallery is detached from `heroImage`: the hero remains the profile-card thumbnail, while itinerary-gallery images appear only on the public itinerary detail page.

### Curated public sections (v2)

Orbit may additionally send an optional ordered `sections` array. It is a public editorial story, not a day-by-day schedule. When `sections` is present, the Portal preserves its supplied order and renders it in place of the legacy itinerary, accommodation cards, and category gallery strips. When it is omitted, the existing v1 layout remains unchanged.

Each section must have an opaque publication-local UUID `id`, one `kind` of `flight`, `stay`, `transfer`, `cruise`, `experience`, or `note`, plus a public `title`, `summary` of no more than 600 characters, up to five public `facts`, and up to six labelled public images. A section ID must never be an Orbit product ID, quote reference, supplier identifier, or booking reference.

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
  "itineraryImages": [
    {
      "url": "https://supplier-cdn.example.com/the-elser-hotel-miami.jpg",
      "source": "supplier",
      "label": "The Elser Hotel Miami",
      "category": "hotel"
    },
    {
      "url": "https://supplier-cdn.example.com/miami-bay-experience.jpg",
      "source": "supplier",
      "label": "Miami Bay experience",
      "category": "experience"
    }
  ],
  "sections": [
    {
      "id": "f3a5b1f1-6799-4b56-a8de-5b0dceea5ba6",
      "kind": "flight",
      "title": "Begin in Cape Town",
      "summary": "Fly into Cape Town and settle into an itinerary designed to balance the city, coast and Winelands.",
      "facts": ["Economy flights", "Private airport transfer"],
      "images": []
    },
    {
      "id": "c40d004a-8d72-4a94-9b34-1d875c359b8b",
      "kind": "stay",
      "title": "A considered coastal stay",
      "summary": "A relaxed oceanfront base with time to explore at your own pace.",
      "facts": ["5 nights", "Bed & Breakfast", "Bantry Bay"],
      "images": [
        {
          "url": "https://supplier-cdn.example.com/president-hotel.jpg",
          "source": "supplier",
          "label": "President Hotel",
          "category": "hotel"
        }
      ]
    }
  ],
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

All accepted fields are public-facing. `itineraryImages` is optional and accepts a maximum of 24 objects. Each object must contain a public HTTPS URL, `source` of `supplier` or `agent_upload`, a public `label`, and a `category` of `hotel`, `cruise`, or `experience`. `sections` is optional and accepts at most 60 sections, each with up to five facts and six images. The API rejects unknown fields rather than silently retaining them. It never accepts or returns Orbit product IDs, quote references, supplier metadata, booking references, or internal section metadata.

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
