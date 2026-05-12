/**
 * Supplier Directory tRPC router
 * Handles supplier CRUD, stage-based credential access, and agent stage management.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import {
  suppliers,
  agentSupplierStages,
  supplierAttachments,
} from "../drizzle/schema";
import { eq, like, or, and, asc, desc, sql } from "drizzle-orm";

// ─── Helper: get agent's current stage ───────────────────────────────────────
async function getAgentStage(userId: number): Promise<number> {
  const { getDb } = await import("./db");
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  const rows = await db
    .select({ stage: agentSupplierStages.stage })
    .from(agentSupplierStages)
    .where(eq(agentSupplierStages.userId, userId))
    .limit(1);
  return rows[0]?.stage ?? 1;
}

// ─── Helper: strip credentials based on stage ────────────────────────────────
function applyStageFilter(
  supplier: typeof suppliers.$inferSelect,
  agentStage: number,
  isAdmin: boolean
) {
  if (isAdmin) return supplier; // admins see everything
  const canSeeCredentials = agentStage >= supplier.credentialStage;
  return {
    ...supplier,
    loginUsername: canSeeCredentials ? supplier.loginUsername : null,
    loginPassword: canSeeCredentials ? supplier.loginPassword : null,
    agencyId: canSeeCredentials ? supplier.agencyId : null,
    // tradeWebsite is always visible (it's a public URL, not a credential)
    adminUsername: null,  // agents never see admin credentials
    adminPassword: null,
    adminNotes: null,
  };
}

export const suppliersRouter = router({
  // ── List suppliers (with search/filter) ────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        category: z.string().optional(),
        location: z.string().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(24),
      })
    )
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "super_admin";
      const agentStage = isAdmin ? 3 : await getAgentStage(ctx.user.id);

      const conditions = [eq(suppliers.isActive, 1)];

      if (input.search) {
        const term = `%${input.search}%`;
        conditions.push(
          or(
            like(suppliers.name, term),
            like(suppliers.description, term),
            like(suppliers.categories, term),
            like(suppliers.accountManager, term)
          )!
        );
      }

      if (input.category) {
        conditions.push(like(suppliers.categories, `%${input.category}%`));
      }

      if (input.location) {
        conditions.push(like(suppliers.locations, `%${input.location}%`));
      }

      const offset = (input.page - 1) * input.pageSize;

        const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(suppliers)
          .where(and(...conditions))
          .orderBy(asc(suppliers.sortOrder), asc(suppliers.name))
          .limit(input.pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(suppliers)
          .where(and(...conditions)),
      ]);

      const total = Number(countResult[0]?.count ?? 0);

      return {
        suppliers: rows.map((s: typeof suppliers.$inferSelect) => applyStageFilter(s, agentStage, isAdmin)),
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
        agentStage,
      };
    }),

  // ── Get single supplier ─────────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "super_admin";
      const agentStage = isAdmin ? 3 : await getAgentStage(ctx.user.id);

      const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, input.id), eq(suppliers.isActive, 1)))
        .limit(1);

      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return applyStageFilter(rows[0], agentStage, isAdmin);
    }),

  // ── Get all unique categories ───────────────────────────────────────────────
  categories: protectedProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .select({ categories: suppliers.categories })
      .from(suppliers)
      .where(eq(suppliers.isActive, 1));

    const cats = new Set<string>();
    for (const row of rows) {
      if (row.categories) {
        row.categories.split(";").forEach((c: string) => {
          const t = c.trim();
          if (t) cats.add(t);
        });
      }
    }
    return Array.from(cats).sort();
  }),

  // ── Get all unique locations ────────────────────────────────────────────────
  locations: protectedProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .select({ locations: suppliers.locations })
      .from(suppliers)
      .where(eq(suppliers.isActive, 1));

    const locs = new Set<string>();
    for (const row of rows) {
      if (row.locations) {
        row.locations.split(";").forEach((l: string) => {
          const t = l.trim();
          if (t) locs.add(t);
        });
      }
    }
    return Array.from(locs).sort();
  }),

  // ── Get all suppliers for dropdown (name + id only) ─────────────────────────
  dropdown: protectedProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        categories: suppliers.categories,
        imageUrl: suppliers.imageUrl,
      })
      .from(suppliers)
      .where(eq(suppliers.isActive, 1))
      .orderBy(asc(suppliers.name));
  }),

  // ── Admin: Create supplier ──────────────────────────────────────────────────
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        shortDescription: z.string().optional(),
        publicWebsite: z.string().optional(),
        tradeWebsite: z.string().optional(),
        additionalWebsite: z.string().optional(),
        agencyId: z.string().optional(),
        loginUsername: z.string().optional(),
        loginPassword: z.string().optional(),
        commission: z.string().optional(),
        facebookUrl: z.string().optional(),
        instagramUrl: z.string().optional(),
        mediaAssetsUrl: z.string().optional(),
        accountManager: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        generalNotes: z.string().optional(),
        video1: z.string().optional(),
        video2: z.string().optional(),
        video3: z.string().optional(),
        video4: z.string().optional(),
        video5: z.string().optional(),
        categories: z.string().optional(),
        locations: z.string().optional(),
        imageUrl: z.string().optional(),
        adminUsername: z.string().optional(),
        adminPassword: z.string().optional(),
        adminNotes: z.string().optional(),
        credentialStage: z.number().int().min(1).max(3).default(2),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [result] = await db.insert(suppliers).values({
        ...input,
        isActive: 1,
        sortOrder: 0,
      });
      return { id: (result as any).insertId };
    }),

  // ── Admin: Update supplier ──────────────────────────────────────────────────
  update: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        shortDescription: z.string().optional(),
        publicWebsite: z.string().optional(),
        tradeWebsite: z.string().optional(),
        additionalWebsite: z.string().optional(),
        agencyId: z.string().optional(),
        loginUsername: z.string().optional(),
        loginPassword: z.string().optional(),
        commission: z.string().optional(),
        facebookUrl: z.string().optional(),
        instagramUrl: z.string().optional(),
        mediaAssetsUrl: z.string().optional(),
        accountManager: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        generalNotes: z.string().optional(),
        video1: z.string().optional(),
        video2: z.string().optional(),
        video3: z.string().optional(),
        video4: z.string().optional(),
        video5: z.string().optional(),
        categories: z.string().optional(),
        locations: z.string().optional(),
        imageUrl: z.string().optional(),
        adminUsername: z.string().optional(),
        adminPassword: z.string().optional(),
        adminNotes: z.string().optional(),
        credentialStage: z.number().int().min(1).max(3).optional(),
        isActive: z.number().int().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { id, ...data } = input;
      await db.update(suppliers).set(data).where(eq(suppliers.id, id));
      return { ok: true };
    }),

  // ── Admin: Delete supplier (soft delete) ────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .update(suppliers)
        .set({ isActive: 0 })
        .where(eq(suppliers.id, input.id));
      return { ok: true };
    }),

  // ── Get agent's supplier stage ──────────────────────────────────────────────
  getAgentStage: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      // Agents can only query their own stage; admins can query any
      if (ctx.user.role !== "admin" && ctx.user.id !== input.userId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const stage = await getAgentStage(input.userId);
      return { stage };
    }),

  // ── Admin: Set agent's supplier stage ──────────────────────────────────────
  setAgentStage: adminProcedure
    .input(
      z.object({
        userId: z.number().int(),
        stage: z.number().int().min(1).max(3),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Upsert: delete existing then insert
      await db
        .delete(agentSupplierStages)
        .where(eq(agentSupplierStages.userId, input.userId));
      await db.insert(agentSupplierStages).values({
        userId: input.userId,
        stage: input.stage,
        unlockedById: ctx.user.id,
      });
      return { ok: true };
    }),

  // ── Admin: Get stage for a specific agent ──────────────────────────────────────────
  getAgentStageFor: adminProcedure
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select({ stage: agentSupplierStages.stage })
        .from(agentSupplierStages)
        .where(eq(agentSupplierStages.userId, input.userId))
        .limit(1);
      return { stage: rows[0]?.stage ?? 1 };
    }),

  // ── Admin: Get all agents with their stages ───────────────────────────────────────────────
  allAgentStages: adminProcedure.query(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db
      .select()
      .from(agentSupplierStages)
      .orderBy(desc(agentSupplierStages.unlockedAt));
  }),

  // ── AI: Scrape website and auto-fill supplier fields ──────────────────────────────────────
  scrapeWebsite: adminProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      // Fetch the website content
      let pageText = "";
      let ogTitle = "";
      let ogDescription = "";
      try {
        const resp = await fetch(input.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const html = await resp.text();
        // Extract OG/meta tags first for better quality data
        const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
          || html.match(/<title[^>]*>([^<]+)<\/title>/i);
        ogTitle = ogTitleMatch?.[1]?.trim() ?? "";
        const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)
          || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
        ogDescription = ogDescMatch?.[1]?.trim() ?? "";
        // Strip HTML tags to get readable body text
        pageText = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s{3,}/g, " ")
          .trim()
          .slice(0, 10000);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Could not fetch website: ${e}` });
      }

      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a travel industry data extraction assistant. Extract structured information about a travel supplier from their website. Return ONLY valid JSON with these fields (use null for unknown fields):
{
  "name": string (company/brand name — use the OG title if helpful),
  "description": string (2-4 sentences, plain text, no HTML — describe what they offer),
  "shortDescription": string (1 concise sentence),
  "categories": string (semicolon-separated from: Accommodation, Adventure, Airlines, Cruises, DMCs, Family, Groups, Honeymoon, Hotels, Luxury, Safari, Ski, Tours, Transfers, Weddings),
  "locations": string (semicolon-separated countries/regions they operate in),
  "commission": string (commission rate if mentioned, e.g. "10%" or "NETT", or null),
  "priceTier": string (one of: budget, mid-range, luxury, ultra-luxury),
  "usp": string (2-3 key selling points as bullet points starting with •),
  "notSuitableFor": string (what this supplier is NOT good for, or null)
}`,
          },
          {
            role: "user",
            content: `Website URL: ${input.url}\n${ogTitle ? `Page title: ${ogTitle}\n` : ""}${ogDescription ? `Meta description: ${ogDescription}\n` : ""}\nWebsite content:\n${pageText}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      try {
        const content = ((result.choices[0]?.message?.content as string) ?? "{}");
        return JSON.parse(content);
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to parse AI response" });
      }
    }),

  // ── AI: Analyse training video and extract supplier info ──────────────────────────────────
  analyseVideo: adminProcedure
    .input(z.object({ videoUrl: z.string(), supplierId: z.number().int().optional() }))
    .mutation(async ({ input }) => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      // Normalise Loom URL: extract share/embed URL from HTML snippets
      let videoUrl = input.videoUrl.trim();
      const loomMatch = videoUrl.match(/src=["'](https:\/\/www\.loom\.com\/embed\/[^"'?]+)/i)
        || videoUrl.match(/(https:\/\/www\.loom\.com\/share\/[a-zA-Z0-9]+)/i)
        || videoUrl.match(/(https:\/\/www\.loom\.com\/embed\/[a-zA-Z0-9]+)/i);
      if (loomMatch) videoUrl = loomMatch[1];
      // Convert embed URLs to share URLs for better compatibility
      videoUrl = videoUrl.replace("loom.com/embed/", "loom.com/share/");

      const prompt = `This is a travel industry training video about a supplier. Extract the following information and return ONLY valid JSON:
{
  "supplierName": string (the name of the travel supplier being presented),
  "description": string (2-4 sentences about what this supplier offers — destinations, product types, target clients),
  "categories": string (semicolon-separated travel categories from: Accommodation, Adventure, Airlines, Cruises, DMCs, Family, Groups, Honeymoon, Hotels, Luxury, Safari, Ski, Tours, Transfers, Weddings),
  "locations": string (semicolon-separated destinations/countries/regions they operate in),
  "usp": string (2-3 genuine key selling points as bullet points starting with •),
  "priceTier": string (one of: budget, mid-range, luxury, ultra-luxury),
  "notSuitableFor": string (specific scenarios this supplier is NOT ideal for),
  "bookingTips": string (2-3 practical bullet points starting with • that an agent should know when booking),
  "keyProducts": string (main products/packages/itineraries mentioned in the video)
}`;

      try {
        const { stdout } = await execFileAsync(
          "manus-analyze-video",
          [videoUrl, prompt],
          { timeout: 120000 } // 2 min timeout
        );
        // Extract JSON from the output
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in video analysis output");
        return JSON.parse(jsonMatch[0]);
      } catch (e: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Video analysis failed: ${e?.message ?? e}. Make sure the Loom URL is a valid share link (e.g. https://www.loom.com/share/abc123).`,
        });
      }
    }),

  // ── AI: Enrich a single supplier using existing data ──────────────────────────────────────
  enrichSupplier: adminProcedure
    .input(z.object({ supplierId: z.number().int() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const { invokeLLM } = await import("./_core/llm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
      if (!supplier) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found" });

      const context = [
        `Name: ${supplier.name}`,
        supplier.shortDescription ? `Short description: ${supplier.shortDescription}` : "",
        supplier.description ? `Description: ${supplier.description.replace(/<[^>]+>/g, " ").slice(0, 2000)}` : "",
        supplier.categories ? `Categories: ${supplier.categories}` : "",
        supplier.locations ? `Locations/destinations: ${supplier.locations}` : "",
        supplier.commission ? `Commission: ${supplier.commission}` : "",
        supplier.generalNotes ? `Internal notes: ${supplier.generalNotes.slice(0, 800)}` : "",
      ].filter(Boolean).join("\n");

      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an expert travel industry consultant helping travel agents understand suppliers. Based on the supplier information provided, generate enrichment data written from the agent's perspective. Return ONLY valid JSON with these exact fields:
{
  "usp": string (2-3 specific bullet points starting with • of what genuinely makes this supplier stand out — be concrete, not generic),
  "priceTier": string (one of exactly: budget, mid-range, luxury, ultra-luxury — infer from name/description/commission),
  "notSuitableFor": string (specific scenarios this supplier is NOT ideal for, e.g. "Last-minute bookings, solo travellers on a budget, clients needing flexible cancellation"),
  "aiSummary": string (2-3 sentences written for an agent — start with 'Use this supplier when...' or 'Best for...' — mention destinations, specialisms, and what type of client will love them),
  "idealClient": string (comma-separated client types this supplier is perfect for, e.g. "Honeymooners, luxury couples, anniversary travellers, high-net-worth clients"),
  "bookingTips": string (2-3 practical bullet points starting with • that an agent should know when booking this supplier — e.g. booking lead time, how to contact, any gotchas, exclusive rates, trade portal tips)
}`,
          },
          { role: "user", content: context },
        ],
        response_format: { type: "json_object" },
      });

      try {
        const content = ((result.choices[0]?.message?.content as string) ?? "{}");
        const enriched = JSON.parse(content);
        await db.update(suppliers)
          .set({
            usp: enriched.usp ?? supplier.usp,
            priceTier: enriched.priceTier ?? supplier.priceTier,
            notSuitableFor: enriched.notSuitableFor ?? supplier.notSuitableFor,
            aiSummary: enriched.aiSummary ?? supplier.aiSummary,
            idealClient: enriched.idealClient ?? (supplier as any).idealClient,
            bookingTips: enriched.bookingTips ?? (supplier as any).bookingTips,
            aiEnrichedAt: new Date(),
          })
          .where(eq(suppliers.id, input.supplierId));
        return { ok: true, ...enriched };
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to parse AI response" });
      }
    }),

  // ── AI: Batch enrich all suppliers ────────────────────────────────────────────────────────
  enrichAllSuppliers: adminProcedure
    .input(z.object({ onlyUnenriched: z.boolean().default(true) }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const allSuppliers = await db
        .select()
        .from(suppliers)
        .where(
          input.onlyUnenriched
            ? sql`${suppliers.aiEnrichedAt} IS NULL`
            : sql`1=1`
        );

      // Process in background — return immediately with count
      const count = allSuppliers.length;
      // Fire and forget enrichment
      (async () => {
        const { invokeLLM } = await import("./_core/llm");
        for (const supplier of allSuppliers) {
          try {
            const context = [
              `Name: ${supplier.name}`,
              supplier.shortDescription ? `Short description: ${supplier.shortDescription}` : "",
              supplier.description ? `Description: ${supplier.description.replace(/<[^>]+>/g, " ").slice(0, 2000)}` : "",
              supplier.categories ? `Categories: ${supplier.categories}` : "",
              supplier.locations ? `Locations/destinations: ${supplier.locations}` : "",
              supplier.commission ? `Commission: ${supplier.commission}` : "",
              supplier.generalNotes ? `Internal notes: ${supplier.generalNotes.slice(0, 800)}` : "",
            ].filter(Boolean).join("\n");

            const result = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content: `You are an expert travel industry consultant helping travel agents understand suppliers. Based on the supplier information provided, generate enrichment data written from the agent's perspective. Return ONLY valid JSON with these exact fields:
{"usp":string (2-3 specific bullet points starting with • of what genuinely makes this supplier stand out),"priceTier":string (one of exactly: budget, mid-range, luxury, ultra-luxury),"notSuitableFor":string (specific scenarios this supplier is NOT ideal for),"aiSummary":string (2-3 sentences for an agent — start with 'Use this supplier when...' or 'Best for...' — mention destinations, specialisms, client types),"idealClient":string (comma-separated client types this supplier is perfect for),"bookingTips":string (2-3 practical bullet points starting with • that an agent should know when booking)}`,
                },
                { role: "user", content: context },
              ],
              response_format: { type: "json_object" },
            });
            const enriched = JSON.parse(((result.choices[0]?.message?.content as string) ?? "{}"));
            await db.update(suppliers)
              .set({
                usp: enriched.usp ?? null,
                priceTier: enriched.priceTier ?? null,
                notSuitableFor: enriched.notSuitableFor ?? null,
                aiSummary: enriched.aiSummary ?? null,
                idealClient: enriched.idealClient ?? null,
                bookingTips: enriched.bookingTips ?? null,
                aiEnrichedAt: new Date(),
              })
              .where(eq(suppliers.id, supplier.id));
            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 300));
          } catch { /* skip on error */ }
        }
      })();

      return { ok: true, count, message: `Started enriching ${count} suppliers in the background` };
    }),

  // ── AI: Smart search (LLM query understanding + filtered results) ─────────────────────────
  aiSearch: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(500),
      limit: z.number().min(1).max(20).default(8),
    }))
    .query(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const { invokeLLM } = await import("./_core/llm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Step 1: LLM extracts structured intent from the query
      const intentResult = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a travel supplier search assistant. Extract search intent from a travel agent's query. Return ONLY valid JSON:
{
  "destinations": string[] (countries/regions mentioned or implied),
  "tripTypes": string[] (e.g. honeymoon, family, adventure, luxury, group, cruise, safari, ski, beach, city break),
  "clientType": string (couples/family/solo/group/corporate or null),
  "priceTier": string (budget/mid-range/luxury/ultra-luxury or null),
  "keywords": string[] (other important keywords for matching),
  "searchSummary": string (1 sentence describing what the agent is looking for)
}`,
          },
          { role: "user", content: input.query },
        ],
        response_format: { type: "json_object" },
      });

      let intent: { destinations?: string[]; tripTypes?: string[]; clientType?: string; priceTier?: string; keywords?: string[]; searchSummary?: string } = {};
      try {
        intent = JSON.parse((intentResult.choices[0]?.message?.content as string) ?? "{}");
      } catch { /* use empty intent */ }

      // Step 2: Fetch all active suppliers
      const agentStage = await getAgentStage(ctx.user.id);
      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "super_admin";
      const allSuppliers = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.isActive, 1))
        .orderBy(asc(suppliers.sortOrder), asc(suppliers.name));

      // Step 3: LLM ranks and filters the suppliers based on intent
      const supplierSummaries = allSuppliers.map(s => ({
        id: s.id,
        name: s.name,
        categories: s.categories ?? "",
        locations: s.locations ?? "",
        priceTier: s.priceTier ?? "",
        aiSummary: s.aiSummary ?? "",
        usp: s.usp ?? "",
        description: (s.description ?? "").replace(/<[^>]+>/g, " ").slice(0, 200),
      }));

      const rankResult = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a travel supplier matching expert. Given a search intent and a list of suppliers, return the IDs of the best matching suppliers in order of relevance. Return ONLY valid JSON:
{
  "matches": [
    { "id": number, "relevanceScore": number (0-100), "reason": string (1 sentence why this supplier matches) }
  ]
}
Return at most ${input.limit} matches. Only include suppliers that are genuinely relevant.`,
          },
          {
            role: "user",
            content: `Search intent: ${JSON.stringify(intent)}\n\nAvailable suppliers:\n${JSON.stringify(supplierSummaries)}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      let matches: { id: number; relevanceScore: number; reason: string }[] = [];
      try {
        const ranked = JSON.parse((rankResult.choices[0]?.message?.content as string) ?? "{}");
        matches = ranked.matches ?? [];
      } catch { /* return empty */ }

      // Step 4: Fetch full supplier data for matched IDs
      const matchedIds = matches.map(m => m.id);
      const matchedSuppliers = allSuppliers
        .filter(s => matchedIds.includes(s.id))
        .map(s => applyStageFilter(s, agentStage, isAdmin));

      // Merge relevance data
      const results = matches
        .map(m => {
          const supplier = matchedSuppliers.find(s => s.id === m.id);
          if (!supplier) return null;
          return { ...supplier, relevanceScore: m.relevanceScore, matchReason: m.reason };
        })
        .filter(Boolean);

      return {
        results,
        searchSummary: intent.searchSummary ?? input.query,
        totalFound: results.length,
      };
    }),

  // ── AI: Chat assistant for supplier recommendations ───────────────────────────────────────
  // ── Admin: Upload supplier logo (multipart, compress to WebP, store in S3) ─────────────────
  uploadLogo: adminProcedure
    .input(z.object({
      supplierId: z.number().int(),
      fileBase64: z.string(), // base64-encoded image
      mimeType: z.string(),   // e.g. image/png
      fileName: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { storagePut } = await import("./storage");
      const sharp = (await import("sharp")).default;

      // Decode base64
      const buffer = Buffer.from(input.fileBase64, "base64");

      // Compress: resize to max 400x400, convert to WebP at quality 80
      const compressed = await sharp(buffer)
        .resize(400, 400, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      const key = `supplier-logos/${input.supplierId}-logo-${Date.now()}.webp`;
      const { url } = await storagePut(key, compressed, "image/webp");

      // Update the supplier's imageUrl
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.update(suppliers).set({ imageUrl: url }).where(eq(suppliers.id, input.supplierId));

      return { url };
    }),

  // ── Admin: Upload supplier attachment (PDF, brochure, etc.) ──────────────────────────────
  uploadAttachment: adminProcedure
    .input(z.object({
      supplierId: z.number().int(),
      fileBase64: z.string(),
      mimeType: z.string(),
      fileName: z.string(),
      fileSize: z.number().int().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { storagePut } = await import("./storage");
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const buffer = Buffer.from(input.fileBase64, "base64");
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const key = `supplier-attachments/${input.supplierId}/${Date.now()}-${safeName}`;
      const { url } = await storagePut(key, buffer, input.mimeType);

      const [result] = await db.insert(supplierAttachments).values({
        supplierId: input.supplierId,
        fileName: input.fileName,
        fileUrl: url,
        fileKey: key,
        fileSize: input.fileSize ?? buffer.length,
        uploadedById: ctx.user.id,
      });

      return { id: (result as any).insertId, url, fileName: input.fileName };
    }),

  // ── List attachments for a supplier ──────────────────────────────────────────────────────
  listAttachments: protectedProcedure
    .input(z.object({ supplierId: z.number().int() }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return db
        .select()
        .from(supplierAttachments)
        .where(eq(supplierAttachments.supplierId, input.supplierId))
        .orderBy(desc(supplierAttachments.uploadedAt));
    }),

  // ── Admin: Delete attachment ──────────────────────────────────────────────────────────────
  deleteAttachment: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Get the record first so we can delete from S3 if needed
      const [att] = await db.select().from(supplierAttachments).where(eq(supplierAttachments.id, input.id)).limit(1);
      if (!att) throw new TRPCError({ code: "NOT_FOUND" });
      await db.delete(supplierAttachments).where(eq(supplierAttachments.id, input.id));
      return { ok: true };
    }),

  aiChat: protectedProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })),
      supplierId: z.number().int().optional(), // if chatting about a specific supplier
    }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("./db");
      const { invokeLLM } = await import("./_core/llm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const agentStage = await getAgentStage(ctx.user.id);
      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "super_admin";

      // If chatting about a specific supplier, include their full data
      let supplierContext = "";
      if (input.supplierId) {
        const [s] = await db.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
        if (s) {
          const filtered = applyStageFilter(s, agentStage, isAdmin);
          supplierContext = `\n\nYou are answering questions about this specific supplier:\n${JSON.stringify({
            name: filtered.name,
            description: (filtered.description ?? "").replace(/<[^>]+>/g, " "),
            categories: filtered.categories,
            locations: filtered.locations,
            commission: filtered.commission,
            usp: filtered.usp,
            priceTier: filtered.priceTier,
            notSuitableFor: filtered.notSuitableFor,
            generalNotes: filtered.generalNotes,
          })}`;
        }
      } else {
        // General chat — include all supplier summaries for context
        const allSuppliers = await db.select().from(suppliers).where(eq(suppliers.isActive, 1));
        supplierContext = `\n\nYou have access to ${allSuppliers.length} suppliers in the JLT Group supplier directory. Here are summaries:\n` +
          allSuppliers.map(s => `- ${s.name} (${s.categories ?? ""}) | ${s.locations ?? ""} | ${s.priceTier ?? ""} | ${s.aiSummary ?? s.shortDescription ?? ""}`).join("\n").slice(0, 6000);
      }

      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a knowledgeable travel industry assistant for JLT Group travel agents. Help agents find the right suppliers for their client enquiries. Be concise, practical, and specific. When recommending suppliers, explain why they're a good fit.${supplierContext}`,
          },
          ...input.messages,
        ],
      });

      return {
        reply: result.choices[0]?.message?.content ?? "Sorry, I couldn't generate a response.",
      };
    }),
});
