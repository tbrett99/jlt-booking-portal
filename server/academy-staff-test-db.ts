import { getTableName } from "drizzle-orm";

/** In-memory test adapter only: evaluates the actual Drizzle eq/ne/inArray/and
 * predicates so missing server filters are detected, not masked by canned rows. */
export function academyMockDb(initial: Record<string, any[]>) {
  const tables: Record<string, any[]> = structuredClone(initial);
  const reads: Array<{ table: string; projection: any }> = [];
  let transactionActive = false;
  const locks: string[] = [];
  let transactionLocksStart = 0;
  const writes: Array<{ table: string; operation: string; values?: any }> = [];
  const tableName = (table: any) => getTableName(table);
  const column = (value: any) => !!value?.table && typeof value.name === "string";
  const value = (item: any, bindings: Record<string, any>): any => {
    if (column(item)) return bindings[tableName(item.table)]?.[item.name];
    if (Array.isArray(item)) return item.map(v => value(v, bindings));
    if (item && "encoder" in item) return item.value;
    return item;
  };
  function matches(predicate: any, bindings: Record<string, any>): boolean {
    if (!predicate) return true;
    const chunks: any[] = predicate.queryChunks ?? [];
    const columns = chunks.filter(column);
    if (columns.length) {
      const at = chunks.indexOf(columns[0]);
      const op = chunks[at + 1]?.value?.join("").trim();
      const left = value(columns[0], bindings);
      const right = value(chunks[at + 2], bindings);
      // Omitted nullable fields in older synthetic fixtures represent SQL NULL.
      if (op === "is null") return left === null || left === undefined;
      if (op === "=") return left === right;
      if (op === "<>") return left !== right;
      if (op === "in") return right.includes(left);
      if (op === "<=") return left <= right;
      throw new Error(`Unsupported mock predicate operator: ${op}`);
    }
    const nested = chunks.filter(chunk => !!chunk?.queryChunks);
    if (nested.length) return nested.every(chunk => matches(chunk, bindings));
    throw new Error("Unsupported mock SQL expression");
  }
  function project(projection: any, bindings: Record<string, any>, base: string): any {
    if (!projection) return { ...bindings[base] };
    if (column(projection)) return value(projection, bindings);
    if (projection?.[Symbol.for("drizzle:IsDrizzleTable")]) return { ...bindings[tableName(projection)] };
    return Object.fromEntries(Object.entries(projection).map(([key, p]) => [key, project(p, bindings, base)]));
  }
  const db: any = {
    select(projection?: any) {
      let base = "";
      let bindings: Record<string, any>[] = [];
      let predicate: any;
      let max = Infinity;
      const query: any = {
        from(table: any) { base = tableName(table); reads.push({ table: base, projection }); bindings = (tables[base] ?? []).map(row => ({ [base]: row })); return query; },
        innerJoin(table: any, condition: any) {
          const name = tableName(table);
          bindings = bindings.flatMap(binding => (tables[name] ?? []).map(row => ({ ...binding, [name]: row })).filter(next => matches(condition, next)));
          return query;
        },
        where(condition: any) { predicate = condition; return query; },
        orderBy() { return query; },
        limit(n: number) { max = n; return query; },
        for(mode: string) {
          if (!transactionActive || mode !== "update") throw new Error("Row locks require an active test transaction");
          if (locks.length === transactionLocksStart && base !== "academy_courses") throw new Error("Course must be locked before child rows");
          locks.push(base);
          return query;
        },
        then(resolve: any, reject: any) { return Promise.resolve().then(() => bindings.filter(binding => matches(predicate, binding)).slice(0, max).map(binding => project(projection, binding, base))).then(resolve, reject); },
      };
      return query;
    },
    update(table: any) {
      const name = tableName(table);
      return { set(values: any) { return { async where(predicate: any) {
        writes.push({ table: name, operation: "update", values });
        (tables[name] ?? []).filter(row => matches(predicate, { [name]: row })).forEach(row => Object.assign(row, values));
        return { affectedRows: 1 };
      } }; } };
    },
    insert(table: any) {
      const name = tableName(table);
      return { async values(values: any) {
        writes.push({ table: name, operation: "insert", values });
        const list = Array.isArray(values) ? values : [values];
        const rows = tables[name] ??= [];
        const id = rows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1;
        list.forEach((row, index) => rows.push({ id: id + index, ...row }));
        return { insertId: id };
      } };
    },
    delete(table: any) {
      const name = tableName(table);
      return { async where(predicate: any) {
        writes.push({ table: name, operation: "delete" });
        tables[name] = (tables[name] ?? []).filter(row => !matches(predicate, { [name]: row }));
      } };
    },
  };
  db.session = { client: { async execute(query: string, params: any[]) {
    if (!transactionActive || locks.length === transactionLocksStart) throw new Error("Prepared insert escaped the locked transaction");
    const match = query.match(/^\s*INSERT INTO (academy_lessons)\s*\(([^)]+)\)\s*VALUES/i);
    if (!match) throw new Error("Unsupported transaction prepared SQL in test adapter");
    const columns = match[2].split(",").map(column => column.trim());
    if (columns.length !== params.length || (query.match(/\?/g) ?? []).length !== params.length || params.includes(undefined)) throw new Error("Invalid native prepared parameters");
    const name = match[1];
    const rows = tables[name] ??= [];
    const id = rows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1;
    const values = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
    writes.push({ table: name, operation: "insert", values });
    rows.push({ id, ...values });
    return [{ insertId: id }];
  } } };
  db.transaction = async (callback: any, config: any) => {
    if (transactionActive || config?.isolationLevel !== "repeatable read") throw new Error("Invalid test transaction");
    const before = structuredClone(tables); const writesBefore = writes.length;
    transactionLocksStart = locks.length;
    transactionActive = true;
    try { return await callback(db); }
    catch (error) {
      for (const name of Object.keys(tables)) delete tables[name];
      Object.assign(tables, before); writes.splice(writesBefore);
      throw error;
    } finally { transactionActive = false; }
  };
  return { db, tables, reads, writes, locks };
}
