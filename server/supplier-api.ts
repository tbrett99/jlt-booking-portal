/**
 * JLT Supplier Directory REST API — v1
 *
 * Exposes the portal's supplier database to external systems (e.g. Tom's CRM).
 * Auth: X-API-Key header (shared secret stored in SUPPLIER_API_KEY env var).
 *
 * Endpoints:
 *   GET    /api/v1/suppliers          — search/list active suppliers
 *   GET    /api/v1/suppliers/:id      — get single supplier by ID
 *   POST   /api/v1/suppliers          — create supplier
 *   PUT    /api/v1/suppliers/:id      — update supplier
 */

import { Router, Request, Response, NextFunction } from "express";
import { getDb } from "./db";
import { suppliers } from "../drizzle/schema";
import { eq, like, and, asc, sql } from "drizzle-orm";

const ALLOWED_TYPES = [
  "hotel",
  "flight",
  "transfer",
  "package",
  "cruise",
  "car_hire",
  "insurance",
  "other",
] as const;

type SupplierType = (typeof ALLOWED_TYPES)[number];

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.SUPPLIER_API_KEY;
  if (!apiKey) {
    return res.status(401).json({ error: "API key not configured on server" });
  }
  const provided = req.headers["x-api-key"];
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing X-API-Key" });
  }
  next();
}

// ── CORS middleware ────────────────────────────────────────────────────────────
function supplierApiCors(req: Request, res: Response, next: NextFunction) {
  const allowedOrigins = [
    "https://orbit.thejltgroup.co.uk",
    "https://portal.thejltgroup.co.uk",
    ...(process.env.SUPPLIER_API_ALLOWED_ORIGINS
      ? process.env.SUPPLIER_API_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : []),
  ];

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
}

// ── Map DB row to API response shape ─────────────────────────────────────────
function mapCategoryToType(categories: string | null): SupplierType {
  if (!categories) return "other";
  const first = categories.split(";")[0].trim().toLowerCase();
  const map: Record<string, SupplierType> = {
    hotel: "hotel",
    hotels: "hotel",
    accommodation: "hotel",
    bedbank: "hotel",
    flight: "flight",
    flights: "flight",
    airline: "flight",
    gds: "flight",
    transfer: "transfer",
    transfers: "transfer",
    "ground transfer": "transfer",
    package: "package",
    packages: "package",
    "package holiday": "package",
    "tour operator": "package",
    cruise: "cruise",
    cruises: "cruise",
    "car hire": "car_hire",
    "car rental": "car_hire",
    car: "car_hire",
    insurance: "insurance",
  };
  return map[first] ?? "other";
}

function toApiShape(row: typeof suppliers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    type: mapCategoryToType(row.categories),
    active: row.isActive === 1,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────
export const supplierApiRouter = Router();

supplierApiRouter.use(supplierApiCors);
supplierApiRouter.use(requireApiKey);

// GET /api/v1/suppliers
supplierApiRouter.get("/suppliers", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database unavailable" });

    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const typeFilter = typeof req.query.type === "string" ? req.query.type.trim() : undefined;
    const limit = Math.min(
      parseInt(typeof req.query.limit === "string" ? req.query.limit : "50") || 50,
      200
    );

    if (typeFilter && !ALLOWED_TYPES.includes(typeFilter as SupplierType)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${ALLOWED_TYPES.join(", ")}` });
    }

    let rows: (typeof suppliers.$inferSelect)[];

    if (search) {
      const searchPattern = `%${search}%`;
      rows = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.isActive, 1), like(suppliers.name, searchPattern)))
        .orderBy(asc(suppliers.name))
        .limit(limit * 3);

      // Sort: prefix matches first, then partial
      const searchLower = search.toLowerCase();
      rows.sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(searchLower);
        const bStarts = b.name.toLowerCase().startsWith(searchLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.name.localeCompare(b.name);
      });
    } else {
      rows = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.isActive, 1))
        .orderBy(asc(suppliers.name))
        .limit(limit * 3);
    }

    let results = rows.map(toApiShape);
    if (typeFilter) {
      results = results.filter((r) => r.type === typeFilter);
    }
    results = results.slice(0, limit);

    return res.json({ data: results, total: results.length });
  } catch (err) {
    console.error("[SupplierAPI] GET /suppliers error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/suppliers/:id
supplierApiRouter.get("/suppliers/:id", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database unavailable" });

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid supplier ID" });
    }

    const rows = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    if (!rows.length) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    return res.json(toApiShape(rows[0]));
  } catch (err) {
    console.error("[SupplierAPI] GET /suppliers/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/suppliers
supplierApiRouter.post("/suppliers", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database unavailable" });

    const { name, type } = req.body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required and must be a non-empty string" });
    }
    if (name.trim().length > 255) {
      return res.status(400).json({ error: "name must be 255 characters or fewer" });
    }
    if (!type || !ALLOWED_TYPES.includes(type as SupplierType)) {
      return res.status(400).json({ error: `type is required. Must be one of: ${ALLOWED_TYPES.join(", ")}` });
    }

    // Check for duplicate name (case-insensitive)
    const existing = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(sql`LOWER(${suppliers.name}) = LOWER(${name.trim()})`)
      .limit(1);

    if (existing.length) {
      return res.status(409).json({ error: "A supplier with this name already exists" });
    }

    const [result] = await db.insert(suppliers).values({
      name: name.trim(),
      categories: type,
      isActive: 1,
      sortOrder: 0,
      credentialStage: 2,
    });

    const newId = (result as any).insertId;
    const [newRow] = await db.select().from(suppliers).where(eq(suppliers.id, newId)).limit(1);

    return res.status(201).json(toApiShape(newRow));
  } catch (err) {
    console.error("[SupplierAPI] POST /suppliers error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/v1/suppliers/:id
supplierApiRouter.put("/suppliers/:id", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database unavailable" });

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid supplier ID" });
    }

    const rows = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    if (!rows.length) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    const { name, type, active } = req.body ?? {};
    const updates: Partial<typeof suppliers.$inferInsert> = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name must be a non-empty string" });
      }
      if (name.trim().length > 255) {
        return res.status(400).json({ error: "name must be 255 characters or fewer" });
      }
      const existing = await db
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(sql`LOWER(${suppliers.name}) = LOWER(${name.trim()})`, sql`${suppliers.id} != ${id}`))
        .limit(1);
      if (existing.length) {
        return res.status(409).json({ error: "A supplier with this name already exists" });
      }
      updates.name = name.trim();
    }

    if (type !== undefined) {
      if (!ALLOWED_TYPES.includes(type as SupplierType)) {
        return res.status(400).json({ error: `type must be one of: ${ALLOWED_TYPES.join(", ")}` });
      }
      updates.categories = type;
    }

    if (active !== undefined) {
      updates.isActive = active ? 1 : 0;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(suppliers).set(updates).where(eq(suppliers.id, id));
    }

    const [updated] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    return res.json(toApiShape(updated));
  } catch (err) {
    console.error("[SupplierAPI] PUT /suppliers/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
