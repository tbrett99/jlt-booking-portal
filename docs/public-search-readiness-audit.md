# Public Search Readiness Audit

**Audit date:** 13 September 2026

## Live crawlability finding

The public Holiday Ideas directory at `https://portal.thejltgroup.co.uk/consumer/holiday-ideas` currently renders meaningful public itinerary content, filter controls, agent attribution and internal navigation in text extraction. It is therefore a workable content foundation for organic discovery.

However, the live `https://portal.thejltgroup.co.uk/robots.txt` currently returns:

```text
User-agent: *
Disallow: /
```

This blocks compliant crawlers from crawling every Portal path. While that rule remains in place, the consumer site and individual Holiday Showcase pages should not be expected to gain organic-search visibility. The live sitemap endpoint could not be extracted during this initial audit and requires separate verification.

## Initial implications

The existing content can support destination, duration, price-band and travel-period landing-page discovery, but it needs an indexable public host, a crawl-permitting robots policy, a discoverable sitemap, canonical URLs on the final domain, and purposeful editorial/content expansion before it can operate as a HolidayPirates-style lead-generation channel.

## Canonical domain finding

The intended canonical host, `https://www.thejltgroup.co.uk/`, currently still serves the WordPress holding page rather than the consumer application. Its live `robots.txt` and sitemap are also WordPress-owned. This creates a material canonical mismatch because the consumer application currently writes canonical URLs pointing at `www.thejltgroup.co.uk`, while the meaningful Holiday Ideas content is presently served only at `portal.thejltgroup.co.uk/consumer/holiday-ideas`.

The Portal deployment already contains host-aware search controls designed for the final cutover: it allows crawling and serves a consumer sitemap only when the host is `www.thejltgroup.co.uk`, while intentionally disallowing all Portal-subdomain crawling. The final domain and routing change is therefore the principal launch prerequisite, not a missing Showcase feature.

## Authoritative search and AI-discovery findings

Google documents that a `robots.txt` rule controls whether a compliant crawler may access a URL; when a URL is blocked, Googlebot does not fetch or render the page’s JavaScript. This makes the current site-wide disallow rule the immediate technical blocker for the JavaScript-powered consumer pages. Google can render JavaScript applications, but server-side or pre-rendering remains beneficial because it improves speed and supports bots that cannot execute JavaScript. Google also recommends descriptive page titles, meta descriptions, stable canonical URLs, crawlable HTML links, and testing rendered HTML for JavaScript sites.[1][2]

Google recommends JSON-LD structured data as the easiest format to maintain. Structured data should describe visible, accurate on-page content; it may help search engines understand each page and can make a result eligible for richer presentation, but it does not guarantee a rich result.[3]

For AI-assisted discovery, Bing’s 2026 Webmaster Tools guidance describes page-level citations, grounding queries, and AI-performance measurement across Copilot and Bing AI answers. Its practical content guidance is to deepen expertise, use clear headings/tables/FAQs, support claims with evidence, keep content current, and align text, images, and video. It also identifies IndexNow as a mechanism for notifying participating engines when content is added, updated, or removed.[4]

## HolidayPirates-style pattern, adapted for JLT

HolidayPirates’ public destination pages combine an intent-led destination guide, specific sub-destination links, travel-calendar and holiday-type paths, a stream of relevant live offers, explanatory editorial sections, and a visible email-capture route. Its own article and breadcrumb JSON-LD reflect the visible content. The transferable principle is not to imitate its discount-led language: for JLT, the equivalent is an expert-led discovery path from an intent page (for example, family holidays in Thailand, Caribbean cruise ideas, or Canada road trips) to relevant agent-curated Showcase examples, then a clearly attributed expert enquiry or inspiration-alert signup.[5][6]

## References

[1]: https://developers.google.com/search/docs/crawling-indexing/robots/intro "Google Search Central — Introduction to robots.txt"
[2]: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics "Google Search Central — Understand the JavaScript SEO basics"
[3]: https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data "Google Search Central — Introduction to structured data markup"
[4]: https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview "Bing Webmaster Blog — Introducing AI Performance in Bing Webmaster Tools"
[5]: https://www.holidaypirates.com/destinations/usa "HolidayPirates — USA destination guide"
[6]: https://www.holidaypirates.com/know-how/newsletter "HolidayPirates — newsletter landing page"
