import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./ConsumerSite.tsx", import.meta.url)), "utf8");

describe("ConsumerSite accessibility contract", () => {
  it("provides semantic public-page landmarks and retained keyboard focus styling", () => {
    for (const landmark of ["<header", "<main>", "<footer", "<nav", "<section", "<article", "<aside"]) {
      expect(source).toContain(landmark);
    }
    expect(source).not.toMatch(/outline:\s*none|outline-none|focus:ring-0/);
  });

  it("labels consumer form controls and announces changing agent results", () => {
    expect(source).toContain('aria-label="Search travel experts by name, town or speciality"');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("<PublicField label=\"Your name\">");
    expect(source).toContain("<PublicField label=\"Email address\">");
    expect(source).toContain("<PublicField label=\"Tell us about your trip\">");
  });

  it("keeps the map supplementary with a named region and accessible list fallback", () => {
    expect(source).toContain('aria-labelledby="agent-map-heading"');
    expect(source).toContain('aria-label="Map of JLT travel experts by town"');
    expect(source).toContain("Select a town marker to meet the experts there.");
    expect(source).toContain('aria-label="Choose a town to view its experts"');
    expect(source).toContain("aria-pressed={selectedTown === town}");
    expect(source).toContain("The interactive map is temporarily unavailable.");
    expect(source).toContain("AdvancedMarkerElement");
    expect(source).toContain("TownMapFallback");
    expect(source).toContain('aria-label="Travel expert results"');
  });

  it("keeps holiday showcase inspiration discoverable through linked cards and a dedicated detail page", () => {
    expect(source).toContain("function HolidayShowcaseCard");
    expect(source).toContain("function HolidayShowcaseDetail");
    expect(source).toContain("function HolidayIdeas");
    expect(source).toContain("function FeaturedHolidayIdeas");
    expect(source).toContain('href={publicHref("/holiday-ideas")}');
    expect(source).toContain('aria-label="Search holiday ideas"');
    expect(source).toContain('label="Filter holiday ideas by destination"');
    expect(source).toContain('label="Filter holiday ideas by travel period"');
    expect(source).toContain('label="Filter holiday ideas by price"');
    expect(source).toContain('label="Filter holiday ideas by duration"');
    expect(source).toContain("price_on_request");
    expect(source).toContain("Clear all filters");
    expect(source).toContain("Holiday ideas, by JLT experts");
    expect(source).toContain("https://janinelovestravel.co.uk");
    expect(source).toContain("function ItineraryGallery");
    expect(source).toContain("Visual itinerary");
    expect(source).toContain('loading="lazy"');
    expect(source).toContain('figcaption className="sr-only"');
    expect(source).toContain("holiday-showcases/${showcase.slug}");
    expect(source).toContain("This is travel inspiration, not a live quote.");
  });

  it("keeps public partner logos natural and explains travel protection through clear consumer questions", () => {
    expect(source).toContain("max-h-16 max-w-full object-contain object-left");
    expect(source).toContain("min-h-[230px]");
    expect(source).toContain("Know how your holiday is protected before you pay.");
    expect(source).toContain("PTS Trust Account");
    expect(source).toContain("SFI & SAFI, where included");
    expect(source).toContain("ATOL, where applicable");
    expect(source).toContain("Am I ABTA protected?");
    expect(source).toContain("ProtectionDetailCard");
    expect(source).toContain("https://www.atol.org/about-atol/what-does-atol-protection-mean/");
    expect(source).toContain("https://www.abta.com/tips-and-advice/is-my-money-protected");
  });

  it("renders ordered curated public sections without imposing day labels and supplies showcase metadata", () => {
    expect(source).toContain("function CuratedShowcaseSectionCard");
    expect(source).toContain("function ShowcaseMeta");
    expect(source).toContain("Curated holiday story");
    expect(source).toContain("curatedSections.length > 0");
    expect(source).toContain("application/ld+json");
    expect(source).toContain("BreadcrumbList");
  });
});
