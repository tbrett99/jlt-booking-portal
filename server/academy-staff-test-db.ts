import { getTableName } from "drizzle-orm";

/** In-memory test adapter only: evaluates the actual Drizzle eq/ne/inArray/and
 * predicates so missing server filters are detected, not masked by canned rows. */
export function academyMockDb(initial: Record<string, any[]>) {
  const tables: Record<string, any[]> = structuredClone(initial);
  const reads: Array<{ table: string; projection: any }> = [];
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
  return { db, tables, reads, writes };
}
