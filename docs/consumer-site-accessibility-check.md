# Consumer Website Accessibility Check

**Scope:** `www.thejltgroup.co.uk` consumer routes, checked during implementation on 11 September 2026.

**Verification method:** full-page desktop and mobile browser checks of the homepage, agent finder, and protection page; source-level landmark, ARIA, label, and focus-removal checks; and direct host-header checks of `robots.txt` and `sitemap.xml`.

The consumer experience uses semantic `header`, `main`, `nav`, `section`, `article`, `aside`, and `footer` landmarks. Portal pages are not part of this consumer-site check.

| Check | Result | Evidence / implementation outcome |
|---|---|---|
| Keyboard reachability | Pass | Navigation, filters, public profile links, optional social links, and form controls use native links, buttons, inputs, textarea, and checkbox controls. No custom click-only controls are used for primary consumer actions. |
| Visible focus | Pass | The application’s existing component focus styling is retained; no consumer-site rule removes outlines or focus indicators. |
| Form labels and consent | Pass | The directory search has an accessible name. Each enquiry input has a visible label, and consent is paired with a native checkbox and an explicit privacy-notice link. |
| Semantic landmarks | Pass | A single public header, main region and footer are present. The map region is labelled and the directory filter and results areas have accessible names. |
| Dynamic directory updates | Pass | The expert-result count has `role="status"` and `aria-live="polite"`, so filter and search updates are announced without disrupting focus. |
| Map alternative | Pass | The map is supplementary. The same agents remain available in the accessible result list immediately below it; a plain-language fallback is displayed if maps fail to load. |
| Contrast | Pass | Consumer primary text uses dark navy on ivory/light backgrounds or white on dark navy. Teal/aqua is reserved for accents and primary controls rather than body text on light backgrounds. |
| Mobile reflow | Pass | Full-page checks at 375 × 812 confirmed readable reflow, mobile navigation, stacked actions, and no horizontal overflow on the homepage, agent finder, and protection page. |
| Public indexing controls | Pass | A direct host-header check returned `Allow: /` and the public sitemap only for `www.thejltgroup.co.uk`; the portal host returned `Disallow: /`. The sitemap includes the seven approved public information routes. |

## Deliberate Privacy Safeguards

The public response is an explicit field allow-list. It does not spread CRM records. Tests cover the exclusion of JLT, business and personal emails, mobile numbers, addresses, banking details, payment flags, internal notes, and the private enquiry-delivery address. The public map uses a town-level display only; agents’ private addresses and postcodes are neither queried nor rendered.

## Known Launch Checks

Before public launch, JLT should complete content and compliance approval of protection wording, publish the first controlled speciality tags, and approve at least one agent profile. This will allow a final live test of populated filter, profile, map marker, direct enquiry, and email-delivery paths on the production domain.
