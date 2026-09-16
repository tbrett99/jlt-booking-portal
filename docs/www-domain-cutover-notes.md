# www.thejltgroup.co.uk Consumer-Site Cutover Notes

The current public consumer application is ready to serve the final host. Its server enables a crawlable `robots.txt` and a public sitemap only when the request host is `www.thejltgroup.co.uk`; the Portal host remains intentionally blocked from indexing.

For the Railway service that hosts the JLT Portal and consumer pages, the domain must be added in **Settings → Networking → Public Networking → Custom Domain** as `www.thejltgroup.co.uk`. Railway will provide a unique CNAME target and a TXT ownership-verification record. Both records must be created exactly as supplied in the DNS provider; Railway’s documentation notes that requests return 404 until the TXT verification record is present.[1]

After Railway reports the `www` domain as verified and HTTPS is active, point the existing WordPress/hosting `www` record to Railway’s supplied target, then test the public homepage, `/robots.txt`, `/sitemap.xml`, Holiday Ideas, Showcase links, and existing `portal.thejltgroup.co.uk` staff routes. The apex/root domain should redirect permanently to the chosen canonical `www` host, preserving paths where possible. If DNS is managed through Cloudflare, follow Railway’s current Cloudflare SSL guidance and do not invent a CNAME target—the exact CNAME/TXT values must come from the Railway domain panel.[1]

## Reference

[1]: https://docs.railway.com/networking/domains/working-with-domains "Railway Docs — Working with Domains"
