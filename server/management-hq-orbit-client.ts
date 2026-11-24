import { isIP } from "node:net";
import type {
  HqWireReader,
  HqWirePageQuery,
} from "../shared/management-hq-wire";
import {
  HqContractError,
  createHqWireFailure,
  copyHqWireFailureRule,
  HQ_WIRE_MAX_PAYLOAD_BYTES as HQ_MAX_PAYLOAD_BYTES,
  HQ_WIRE_MAX_TOKEN_LENGTH as HQ_MAX_TOKEN_LENGTH,
  validateHqWireBookingPage,
  validateHqWireBusinessPage,
  validateHqWireChangePage,
  validateHqWireCataloguePage,
  validateHqWireStatus,
  validateHqWireCapabilities,
} from "./management-hq-wire-contract";

export type HqReader = HqWireReader;
export {
  validateHqWireBookingPage,
  validateHqWireBusinessPage,
  validateHqWireChangePage,
  validateHqWireCataloguePage,
  validateHqWireStatus,
  validateHqWireCapabilities,
  validateHqWireError,
  HqContractError,
} from "./management-hq-wire-contract";
export interface HqOrbitClientOptions {
  /** Trusted, fixed server configuration only; never accept this object from RPC input. */
  baseUrl: string;
  apiKey: string;
  /** Must be exactly company_all_real_and_unattributed; no tenant/custom scope. */
  scopeId: string;
  enabled?: boolean;
  /** Only usable with explicit fixture mode and a loopback or reserved .test origin. */
  fetcher?: typeof fetch;
  allowFixtureTransport?: boolean;
}
export const HQ_REQUEST_TIMEOUT_MS = 10000;
const invalidConfiguration = (): never => {
  throw new HqContractError("INVALID_CONFIGURATION");
};

function configuredUrl(options: HqOrbitClientOptions): URL {
  if (
    typeof options.baseUrl !== "string" ||
    options.baseUrl.length > 2048 ||
    options.baseUrl !== options.baseUrl.trim() ||
    /[%\\\s\u0000-\u001f\u007f]/.test(options.baseUrl)
  )
    invalidConfiguration();
  let url: URL;
  try {
    url = new URL(options.baseUrl);
  } catch {
    return invalidConfiguration();
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[?#]/.test(options.baseUrl)
  )
    invalidConfiguration();
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "invalid" ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".")
  )
    invalidConfiguration();
  const fixture = options.allowFixtureTransport === true;
  if (fixture !== (typeof options.fetcher === "function"))
    invalidConfiguration();
  if (fixture) {
    const loopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";
    const memory = hostname.endsWith(".test") && url.protocol === "https:";
    if (memory && options.fetcher === globalThis.fetch) invalidConfiguration();
    if (
      (!loopback && !memory) ||
      (url.protocol !== "http:" && url.protocol !== "https:")
    )
      invalidConfiguration();
  } else {
    // Server configuration is the trust boundary. Disallow literal/local targets,
    // insecure transport and test placeholders, not an RPC-provided arbitrary URL.
    if (
      url.protocol !== "https:" ||
      (url.port && url.port !== "443") ||
      isIP(hostname) ||
      hostname.includes(":") ||
      !hostname.includes(".") ||
      /\.(?:localhost|local|internal|test|example)$/.test(hostname)
    )
      invalidConfiguration();
  }
  if (!/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(url.pathname)) invalidConfiguration();
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}
function token(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > HQ_MAX_TOKEN_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw createHqWireFailure("cursor_shape", "INVALID_QUERY");
  return value;
}
/** Delay hint only; this client never retries. Unknown or malicious values are discarded. */
export function safeHqRetryAfter(
  value: string | null,
  now = Date.now()
): number | undefined {
  if (!value || value.length > 64) return undefined;
  if (/^[0-9]{1,10}$/.test(value)) return Math.min(Number(value), 3600);
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(
      value
    )
  )
    return undefined;
  const when = Date.parse(value);
  return Number.isFinite(when)
    ? Math.min(Math.max(0, Math.ceil((when - now) / 1000)), 3600)
    : undefined;
}

interface ClientState {
  baseUrl: URL;
  apiKey: string;
  scopeId: string;
  enabled: boolean;
  fetcher: typeof fetch;
}
// No URL/key/scope/transport is an enumerable client property, even under inspect.
const clientStates = new WeakMap<HqOrbitClient, ClientState>();
export class HqOrbitClient implements HqWireReader {
  constructor(options: HqOrbitClientOptions) {
    const baseUrl = configuredUrl(options);
    if (
      typeof options.apiKey !== "string" ||
      options.apiKey.length < 32 ||
      options.apiKey.length > 256 ||
      /[^\x21-\x7e]/.test(options.apiKey)
    )
      invalidConfiguration();
    if (options.scopeId !== "company_all_real_and_unattributed")
      invalidConfiguration();
    clientStates.set(this, {
      baseUrl,
      apiKey: options.apiKey,
      scopeId: options.scopeId,
      enabled: options.enabled === true,
      fetcher:
        options.allowFixtureTransport === true
          ? options.fetcher!
          : globalThis.fetch,
    });
  }
  bookings(query?: HqWirePageQuery) {
    return read(
      clientStates.get(this)!,
      "bookings",
      pageQuery(query),
      validateHqWireBookingPage,
      query
    );
  }
  businessMappings(query?: HqWirePageQuery) {
    return read(
      clientStates.get(this)!,
      "business-mappings",
      pageQuery(query),
      validateHqWireBusinessPage,
      query
    );
  }
  catalogue(entityType: "booking" | "business", query?: HqWirePageQuery) {
    if (entityType !== "booking" && entityType !== "business")
      throw createHqWireFailure("page_entity_type", "INVALID_QUERY");
    return read(
      clientStates.get(this)!,
      "catalogue",
      { ...pageQuery(query), entityType },
      value => {
        const page = validateHqWireCataloguePage(value);
        if (page.entityType !== entityType)
          throw createHqWireFailure("page_entity_type");
        return page;
      },
      query
    );
  }
  changes(cursor: string, limit?: number) {
    return read(
      clientStates.get(this)!,
      "changes",
      {
        cursor: token(cursor),
        ...pageQuery(limit === undefined ? undefined : { limit }),
      },
      validateHqWireChangePage,
      limit === undefined ? undefined : { limit }
    );
  }
  status() {
    return read(clientStates.get(this)!, "status", {}, validateHqWireStatus);
  }
  capabilities() {
    return read(
      clientStates.get(this)!,
      "capabilities",
      {},
      validateHqWireCapabilities
    );
  }
}
function pageQuery(query?: HqWirePageQuery): Record<string, string> {
  if (query === undefined) return {};
  if (
    !query ||
    typeof query !== "object" ||
    Array.isArray(query) ||
    Object.getPrototypeOf(query) !== Object.prototype ||
    Object.getOwnPropertySymbols(query).length
  )
    throw createHqWireFailure("query_structure", "INVALID_QUERY");
  const descriptors = Object.getOwnPropertyDescriptors(query);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      !["cursor", "generationId", "limit"].includes(key) ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    )
      throw createHqWireFailure("query_structure", "INVALID_QUERY");
  }
  if (query.cursor !== undefined && query.generationId !== undefined)
    throw createHqWireFailure("query_generation", "INVALID_QUERY");
  const result: Record<string, string> = {};
  if (query.cursor !== undefined) result.cursor = token(query.cursor);
  if (query.generationId !== undefined) {
    if (!Number.isSafeInteger(query.generationId) || query.generationId < 1)
      throw createHqWireFailure("query_generation", "INVALID_QUERY");
    result.generationId = String(query.generationId);
  }
  if (query.limit !== undefined) {
    if (
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    )
      throw createHqWireFailure("query_limit", "INVALID_QUERY");
    result.limit = String(query.limit);
  }
  return result;
}
async function read<T>(
  state: ClientState,
  endpoint:
    | "bookings"
    | "business-mappings"
    | "catalogue"
    | "changes"
    | "status"
    | "capabilities",
  params: Record<string, string>,
  validate: (value: unknown) => T,
  query?: HqWirePageQuery
): Promise<T> {
  if (!state.enabled) throw new HqContractError("CLIENT_DISABLED");
  const url = new URL(state.baseUrl.href);
  url.pathname = `${url.pathname}/${endpoint}`;
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  const controller = new AbortController();
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectTimeout: (reason: HqContractError) => void = () => undefined;
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectTimeout(new HqContractError("TIMEOUT"));
  }, HQ_REQUEST_TIMEOUT_MS);
  const bounded = <V>(work: Promise<V>): Promise<V> =>
    Promise.race([work, timeout]);
  let response: Response | undefined;
  try {
    response = await bounded(
      state.fetcher(url.href, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Orbit-Reporting-Key": state.apiKey,
        },
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      })
    );
    if (
      response.redirected ||
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    )
      throw new HqContractError("REDIRECT_REJECTED");
    if (response.url) {
      let final: URL;
      try {
        final = new URL(response.url);
      } catch {
        throw new HqContractError("REDIRECT_REJECTED");
      }
      if (
        final.origin !== url.origin ||
        final.pathname !== url.pathname ||
        final.search !== url.search ||
        final.username ||
        final.password ||
        final.hash
      )
        throw new HqContractError("REDIRECT_REJECTED");
    }
    if (response.status === 400) throw new HqContractError("INVALID_QUERY");
    if (response.status === 401 || response.status === 403)
      throw new HqContractError("AUTH_DENIED");
    if (response.status === 410) throw new HqContractError("RESTART_REQUIRED");
    if (response.status === 429)
      throw new HqContractError(
        "RATE_LIMITED",
        safeHqRetryAfter(response.headers.get("retry-after"))
      );
    if (response.status === 503) throw new HqContractError("UNAVAILABLE");
    if (response.status !== 200) throw new HqContractError("TRANSPORT_FAILURE");
    if (
      !/^application\/json(?:\s*;|\s*$)/i.test(
        response.headers.get("content-type") ?? ""
      )
    )
      throw new HqContractError("INVALID_PAYLOAD");
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^[0-9]{1,15}$/.test(contentLength) ||
        Number(contentLength) > HQ_MAX_PAYLOAD_BYTES)
    )
      throw new HqContractError("PAYLOAD_TOO_LARGE");
    if (!response.body) throw new HqContractError("INVALID_PAYLOAD");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const result = await bounded(reader.read());
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > HQ_MAX_PAYLOAD_BYTES)
        throw new HqContractError("PAYLOAD_TOO_LARGE");
      chunks.push(result.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(data)
      );
    } catch {
      throw new HqContractError("INVALID_PAYLOAD");
    }
    if (
      endpoint !== "capabilities" &&
      value &&
      typeof value === "object" &&
      Object.hasOwn(value, "scope") &&
      (value as { scope: unknown }).scope !== state.scopeId
    )
      throw new HqContractError("SCOPE_MISMATCH");
    const page = validate(value);
    const wire = page as {
      scope?: unknown;
      generationId?: unknown;
      items?: unknown[];
    };
    if (endpoint !== "capabilities" && wire.scope !== state.scopeId)
      throw new HqContractError("SCOPE_MISMATCH");
    if (
      query?.generationId !== undefined &&
      wire.generationId !== query.generationId
    )
      throw createHqWireFailure("query_generation");
    if (wire.items && wire.items.length > (query?.limit ?? 100))
      throw createHqWireFailure("query_limit");
    return page;
  } catch (error) {
    if (timedOut) throw new HqContractError("TIMEOUT");
    if (error instanceof HqContractError) {
      const sanitized = new HqContractError(error.code, error.safeRetryAfter);
      copyHqWireFailureRule(error, sanitized);
      throw sanitized;
    }
    throw new HqContractError("TRANSPORT_FAILURE");
  } finally {
    clearTimeout(timer);
    if (reader) void reader.cancel().catch(() => undefined);
    else if (response?.body) void response.body.cancel().catch(() => undefined);
    controller.abort();
  }
}
