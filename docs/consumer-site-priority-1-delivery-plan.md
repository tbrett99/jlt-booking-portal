# JLT Consumer Website — Priority 1 Delivery Plan

**Prepared:** 3 October 2026  
**Status:** Ready to build  
**Canonical public domain:** `https://www.thejltgroup.co.uk`

## Purpose

Turn the existing consumer site into a clear **trust, reassurance and lead-generation platform** without changing its established editorial design direction.

The site must help a visitor understand:

1. **Who they are booking with** — their independent travel agent remains their main point of contact; The JLT Group provides the infrastructure behind their business.
2. **How protection works** — protection depends on the specific arrangements purchased and is confirmed in booking documentation.
3. **Why they can trust the agent** — the agent is a verified independent travel business working with The JLT Group.
4. **How to take the next step** — find an agent, explore a public holiday idea, or make an enquiry routed to the relevant agent.

## Confirmed public facts and approved wording

| Topic | Approved information |
|---|---|
| Legal entity | **Janine Loves Ltd trading as The JLT Group** |
| Company number | **12178075** |
| Registered office | **20–22 Wenlock Road, London, England, N1 7GU** |
| ATOL | **ATOL 12564** |
| PTS | **PTS 6090** |
| Public origin story | The travel business that became The JLT Group began in 2023 as Janine Love Travel; Janine Loves Ltd itself was incorporated in 2019. |
| Network figures at launch | **450+ Independent Travel Agents** and **200+ Travel Suppliers** |
| Customer payment explanation | Customer money is handled through arrangements with Protected Trust Services (PTS). The PTS Trust Account structure is designed to protect customer monies and support Package Travel Regulations compliance. Where funds are released before travel, SFI and, where relevant, SAFI are used within the PTS framework. |
| ATOL limitation | ATOL does **not** apply to every product. Where it applies, the customer receives an ATOL Certificate confirming what is protected. |
| Existing booking support | The agent is always the first point of contact. A consumer form is available only for people who cannot identify or reach their agent; it is not an emergency assistance service. |

### Required legal footer

> The JLT Group is a trading name of Janine Loves Ltd, a company registered in England and Wales under company number 12178075. Registered office: 20–22 Wenlock Road, London, England, N1 7GU.

The footer will also display **ATOL 12564 | PTS 6090**. The registered office will be clearly identified as statutory company information, not customer-service contact information.

## Current-state findings

The foundation is already valuable:

- Public agent profiles are searchable and only approved, eligible agents are shown.
- Public holiday showcases have permanent descriptive URLs, agent attribution, enquiry routing and existing client-side Open Graph/JSON-LD support.
- The existing site has `/robots.txt`, an XML sitemap, canonical `www` redirect handling and a consumer-facing protection page.
- The public site has a coherent editorial visual direction which will be retained.

The urgent technical limitation is **crawler visibility**:

- Consumer page title, description, canonical, robots tags and showcase social metadata are currently added in the browser after JavaScript runs.
- The production server returns the client application shell for public routes, so non-JavaScript crawlers and many social scrapers do not receive the meaningful page content or per-page metadata in the initial HTML.
- The existing sitemap includes core pages and live showcases, but not public agent profiles and not the new Protection/Contact pages proposed below.

## Priority 1 scope

### A. Crawlable public content and metadata

Convert the public consumer surface to **server-side rendered public routes with client hydration**. This will leave the authenticated Portal client-rendered and non-indexable.

Public HTML will include:

- meaningful body content in the initial response;
- one unique title tag and meta description per indexable page;
- canonical URL on `www.thejltgroup.co.uk`;
- Open Graph and Twitter card tags;
- correct HTTP 404 responses for unavailable agent profiles and expired/non-public showcases;
- page-specific structured data only where it reflects visible content;
- a `noindex, nofollow` response for private quote/personalised booking paths and Portal-only routes.

Production configuration will use:

- `CANONICAL_ORIGIN=https://www.thejltgroup.co.uk`
- `SITE_NAME=The JLT Group`

### B. Public route map

| Route | Purpose | Indexing |
|---|---|---|
| `/` | Consumer home and reassurance entry point | Indexable |
| `/about` | Who The JLT Group is, origin story and what sits behind an independent agent | Indexable |
| `/your-protection` | Plain-English protection hub | Indexable |
| `/atol-protection` | Dedicated ATOL explanation and certificate guidance | Indexable |
| `/how-your-money-is-protected` | PTS Trust Account, SFI and SAFI explanation | Indexable |
| `/why-jlt-is-on-my-booking` | Direct reassurance page agents can send to clients | Indexable |
| `/find-an-agent` | Search and verify public JLT agents | Indexable |
| `/holiday-ideas` | Public, live holiday showcase discovery | Indexable |
| `/travel-agents/:agentSlug` | Verified agent profile | Indexable when live and eligible |
| `/travel-agents/:agentSlug/holiday-showcases/:showcaseSlug` | Agent-owned public holiday landing page | Indexable when live and eligible |
| `/partners` | Approved partner content | Indexable |
| `/contact` | Support-routing explanation and consumer assistance form | Indexable |
| `/privacy`, `/terms` | Required legal information | Indexable |

Legacy `/consumer/*` routes will redirect to their public canonical equivalent so ranking signals are not split.

### C. Homepage, About and trust language

The homepage will retain its current editorial structure but will gain a direct consumer explanation of the agent/JLT relationship:

> **Your travel agent. Backed by The JLT Group.**
>
> Your travel agent runs their own independent travel business as part of The JLT Group. They remain your personal point of contact, while The JLT Group provides the booking infrastructure, supplier relationships, financial protection and operational support behind your booking.

A simple visual journey will make this immediate:

> **You → Your Travel Agent → The JLT Group → Travel Suppliers**

An editable trust strip will be managed inside the Portal, initially containing:

- ATOL Protected — 12564
- Protected Trust Services — 6090
- IATA Accredited
- 200+ Travel Suppliers
- 450+ Independent Travel Agents

The headings, descriptions and figures will be editable by authorised staff. The implementation will not automatically inflate figures.

The new About page will explain the distinction between Janine Loves Ltd (incorporated 2019) and the travel business that began in 2023 as Janine Love Travel, then grew into The JLT Group.

### D. Protection pages

Protection will be a connected, plain-English set of pages rather than a logo wall.

**Protection hub:**

- what the visitor should check before paying;
- the difference between booking-specific documents and general website information;
- PTS Trust Account, SFI, SAFI, ATOL and Package Travel Regulations;
- the role of travel insurance;
- clear links to relevant official PTS and CAA information.

**ATOL page:**

- what ATOL is;
- why it applies to qualifying flight-inclusive packages and certain flight sales;
- why it does not apply to every product;
- how an ATOL Certificate confirms the protection that actually applies;
- JLT attribution: **Janine Loves Ltd trading as The JLT Group — ATOL 12564**.

**How your money is protected page:**

- a customer-friendly payment-flow explanation;
- approved PTS Trust Account / SFI / SAFI language;
- explicit avoidance of claims such as “all money remains in trust until travel” or “every holiday is ATOL protected”.

**Why JLT is on my booking page:**

- explains why a client may see The JLT Group on a payment link, booking confirmation or ATOL Certificate;
- confirms that their independent agent remains the normal contact;
- explains JLT’s role in supplier access, approved payment channels, protection where applicable, booking systems and operational support.

### E. Consumer contact routing

A new public contact form will be explicitly for customers who **cannot identify or reach their agent**. It will collect:

- full name;
- email;
- telephone;
- booking reference, if known;
- agent or travel-business name, if known;
- departure date, if applicable;
- concise description of the query.

The page will state prominently:

> **Already have a booking?** Your independent travel agent is your first point of contact for questions, amendments and issues relating to your holiday.
>
> **Can’t identify or reach your travel agent?** Use this form and we will help identify the appropriate contact for your booking.

It will also state that the form is **not an emergency assistance service**. The address `support@thejltgroup.co.uk` will not be exposed as the normal public contact route.

Submissions will create an internal, auditable consumer-support case for staff routing, rather than becoming a public inbox or bypassing an agent unnecessarily.

### F. Public showcases and agent verification

Priority 1 will preserve and strengthen the existing lead-generation design:

- every showcase prominently identifies the responsible agent as a **Verified JLT Agent**;
- every showcase has an agent-routed enquiry call to action;
- reassurance wording appears beside enquiries: the enquiry is passed directly to the independent agent responsible for that holiday;
- dynamic title, description, canonical URL and share image are rendered in the initial HTML, not only after JavaScript runs;
- active public agent profiles are included in the sitemap alongside current public showcases;
- private customer quotes remain excluded from search indexing.

## Technical SEO delivery checklist

- Server-render public pages and hydrate them in the browser without visual redesign.
- Add route-specific prefetching for public data; do not embed private authenticated data into HTML.
- Add an XML sitemap covering indexable core pages, active public agent profiles and live public showcases.
- Keep `/robots.txt` public-host aware and point it to the sitemap.
- Add canonical `www` URLs and 301 redirects for non-www and legacy `/consumer/*` public routes.
- Noindex Portal, private quotes, personalised booking/payment paths and internal search/filter states.
- Return genuine 404 responses for missing or unavailable public records.
- Add Organization / TravelAgency and Breadcrumb structured data where visible content substantiates it.
- Add dynamic Open Graph / Twitter image metadata to public agent and showcase detail pages.
- Test rendered HTML with a crawler-style verification script, including route body text, unique metadata, canonical URL, noindex rules, sharing image URLs, redirects and 404s.

## Launch dependencies outside the codebase

After deployment:

1. Verify/add `www.thejltgroup.co.uk` in Google Search Console.
2. Submit `https://www.thejltgroup.co.uk/sitemap.xml`.
3. Request indexing for the home, About, Protection, ATOL, Money Protection, Why JLT and Find an Agent pages.
4. Monitor the Indexing and Crawl reports for redirect, canonical or rendering errors.
5. Review any live legal/protection copy against current PTS and CAA guidance before it is treated as final published wording.

## Deliberately deferred to Priority 2 and 3

### Priority 2

- expanded showcase enquiry fields (traveller count, departure airport and preferred dates);
- broader agent-profile SEO enhancements;
- dedicated Holiday Showcase lead analytics;
- automated social preview generation/monitoring.

### Priority 3

- evergreen destination pages;
- holiday-type landing pages;
- optional editorial/inspiration content;
- controlled internal linking from destinations/types to relevant live showcases.

## Delivery safeguards

- Public content will never expose private agent email addresses, raw supplier payloads, quote references or internal booking data.
- Public agent profiles remain visible only for eligible active agents under the existing approval policy.
- Holiday pages that are personalised or contain client-specific pricing/arrangements remain non-indexable.
- Protection claims will describe the applicable arrangements and documents; they will not make blanket promises that are not true for every booking.
