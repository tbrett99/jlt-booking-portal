import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  agentRecordMerges,
  contractSignatures,
  joinSessions,
  prospectContracts,
  prospects,
  termsSignings,
  termsVersions,
} from "../drizzle/schema";
import {
  AGREEMENT_SOURCES,
  type AgreementSource,
  type MyAgreementDetail,
  type MyAgreementSummary,
} from "../shared/my-agreements";
import { getAgentMergeHistoryIds } from "./agent-merge-identity";
import { getDb } from "./db";
import {
  agreementSignedAt,
  safeAgreementSignature,
  safeAgreementSnapshot,
  safeAgreementStorageUrl,
  safeAgreementStoredHash,
} from "./my-agreements-policy";

const unavailable = () =>
  new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Agreement records temporarily unavailable",
  });
const notFound = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Agreement record not found" });
const validId = (id: unknown): id is number =>
  typeof id === "number" && Number.isSafeInteger(id) && id > 0;
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Independently verify a SELF history, without letting another account's corrupt merge graph block it. */
async function ownedIds(db: Database, currentId: number): Promise<number[]> {
  if (!validId(currentId))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A current account is required",
    });
  const archived = await db
    .select({ sourceUserId: agentRecordMerges.sourceUserId })
    .from(agentRecordMerges)
    .where(eq(agentRecordMerges.sourceUserId, currentId))
    .limit(1);
  if (archived.length)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Archived accounts cannot access agreement records",
    });
  const verified = new Set([currentId]);
  let frontier = [currentId];
  while (frontier.length) {
    const links = await db
      .select({
        sourceUserId: agentRecordMerges.sourceUserId,
        primaryUserId: agentRecordMerges.primaryUserId,
      })
      .from(agentRecordMerges)
      .where(inArray(agentRecordMerges.primaryUserId, frontier));
    const next: number[] = [];
    for (const link of links) {
      if (
        !validId(link.sourceUserId) ||
        !validId(link.primaryUserId) ||
        !frontier.includes(link.primaryUserId) ||
        verified.has(link.sourceUserId)
      ) {
        throw unavailable();
      }
      verified.add(link.sourceUserId);
      next.push(link.sourceUserId);
    }
    frontier = next;
  }
  let history: number[];
  try {
    history = await getAgentMergeHistoryIds(currentId);
  } catch (error) {
    // The existing helper validates every account's graph. Only unrelated graph corruption is
    // recoverable using the scoped, independently verified reads above; SQL/connection errors are not.
    if (
      !(error instanceof Error) ||
      ![
        "Invalid agent merge identity history",
        "Cycle in agent merge identity history",
      ].includes(error.message)
    )
      throw error;
    history = Array.from(verified);
  }
  if (
    !Array.isArray(history) ||
    history.length !== verified.size ||
    new Set(history).size !== history.length ||
    !history.every(id => validId(id) && verified.has(id))
  )
    throw unavailable();
  return [
    currentId,
    ...Array.from(verified)
      .filter(id => id !== currentId)
      .sort((a, b) => a - b),
  ];
}

async function readRows(
  db: Database,
  ids: number[],
  source: AgreementSource,
  requestedId?: number
) {
  switch (source) {
    case "join":
      return db
        .select({
          id: joinSessions.id,
          ownerId: joinSessions.userId,
          signedAt: joinSessions.contractSignedAt,
          signerName: joinSessions.signerName,
          signerAddress: joinSessions.signerAddress,
          signature: joinSessions.signatureDataUrl,
          membershipType: joinSessions.membershipType,
          snapshot: joinSessions.contractTextSnapshot,
          storedHash: joinSessions.contractHash,
          consent: joinSessions.consentConfirmed,
          signingIpRecorded: sql<number>`CASE WHEN ${joinSessions.ipAddress} IS NOT NULL AND TRIM(${joinSessions.ipAddress}) <> '' THEN 1 ELSE 0 END`,
          signingDeviceRecorded: sql<number>`CASE WHEN ${joinSessions.signingUserAgent} IS NOT NULL AND TRIM(${joinSessions.signingUserAgent}) <> '' THEN 1 ELSE 0 END`,
        })
        .from(joinSessions)
        .where(
          and(
            inArray(joinSessions.userId, ids),
            isNotNull(joinSessions.contractSignedAt),
            requestedId === undefined
              ? undefined
              : eq(joinSessions.id, requestedId)
          )
        )
        .orderBy(desc(joinSessions.contractSignedAt), desc(joinSessions.id));
    case "prospect":
      return db
        .select({
          id: prospectContracts.id,
          ownerId: prospects.linkedUserId,
          signedAt: prospectContracts.signedAt,
          signerName: prospectContracts.signerName,
          signerAddress: prospectContracts.signerAddress,
          signature: prospectContracts.signatureDataUrl,
          snapshot: prospectContracts.contractTextSnapshot,
          storedHash: prospectContracts.contractHash,
          consent: prospectContracts.consentConfirmed,
          signingIpRecorded: sql<number>`CASE WHEN ${prospectContracts.signingIp} IS NOT NULL AND TRIM(${prospectContracts.signingIp}) <> '' THEN 1 ELSE 0 END`,
          signingDeviceRecorded: sql<number>`CASE WHEN ${prospectContracts.signingUserAgent} IS NOT NULL AND TRIM(${prospectContracts.signingUserAgent}) <> '' THEN 1 ELSE 0 END`,
        })
        .from(prospectContracts)
        .innerJoin(prospects, eq(prospectContracts.prospectId, prospects.id))
        .where(
          and(
            inArray(prospects.linkedUserId, ids),
            isNotNull(prospectContracts.signedAt),
            requestedId === undefined
              ? undefined
              : eq(prospectContracts.id, requestedId)
          )
        )
        .orderBy(desc(prospectContracts.signedAt), desc(prospectContracts.id));
    case "legacy":
      // No snapshot, hash, consent or signed-document evidence exists in this source. Never fill from a template.
      return db
        .select({
          id: contractSignatures.id,
          ownerId: contractSignatures.userId,
          signedAt: contractSignatures.signedAt,
          signerName: contractSignatures.signerName,
          signerAddress: contractSignatures.signerAddress,
          signature: contractSignatures.signatureDataUrl,
          signingIpRecorded: sql<number>`CASE WHEN ${contractSignatures.ipAddress} IS NOT NULL AND TRIM(${contractSignatures.ipAddress}) <> '' THEN 1 ELSE 0 END`,
        })
        .from(contractSignatures)
        .where(
          and(
            inArray(contractSignatures.userId, ids),
            isNotNull(contractSignatures.signedAt),
            requestedId === undefined
              ? undefined
              : eq(contractSignatures.id, requestedId)
          )
        )
        .orderBy(
          desc(contractSignatures.signedAt),
          desc(contractSignatures.id)
        );
    case "terms":
      // A version-linked document is NOT a signing-time snapshot. Preserve signings if the version was deleted.
      return db
        .select({
          id: termsSignings.id,
          ownerId: termsSignings.userId,
          signedAt: termsSignings.signedAt,
          signerName: termsSignings.signedName,
          signature: termsSignings.signatureImage,
          versionLabel: termsVersions.versionLabel,
          versionDocumentUrl: termsVersions.documentUrl,
          signingIpRecorded: sql<number>`CASE WHEN ${termsSignings.ipAddress} IS NOT NULL AND TRIM(${termsSignings.ipAddress}) <> '' THEN 1 ELSE 0 END`,
          signingDeviceRecorded: sql<number>`CASE WHEN ${termsSignings.userAgent} IS NOT NULL AND TRIM(${termsSignings.userAgent}) <> '' THEN 1 ELSE 0 END`,
        })
        .from(termsSignings)
        .leftJoin(
          termsVersions,
          eq(termsSignings.termsVersionId, termsVersions.id)
        )
        .where(
          and(
            inArray(termsSignings.userId, ids),
            isNotNull(termsSignings.signedAt),
            requestedId === undefined
              ? undefined
              : eq(termsSignings.id, requestedId)
          )
        )
        .orderBy(desc(termsSignings.signedAt), desc(termsSignings.id));
  }
}

type Evidence = {
  id: unknown;
  ownerId: unknown;
  signedAt: unknown;
  signerName?: unknown;
  signerAddress?: unknown;
  signature?: unknown;
  membershipType?: unknown;
  snapshot?: unknown;
  storedHash?: unknown;
  consent?: unknown;
  signingIpRecorded?: unknown;
  signingDeviceRecorded?: unknown;
  versionLabel?: unknown;
  versionDocumentUrl?: unknown;
};
const stringOrNull = (value: unknown) =>
  typeof value === "string" ? value : null;
const flag = (value: unknown) => value === true || value === 1 || value === "1";

function detailFromRow(
  row: Evidence,
  source: AgreementSource,
  currentId: number,
  owners: number[]
): MyAgreementDetail | null {
  // Defense in depth against inconsistent query adapters/data; do not allow mock/adaptor bugs to broaden scope.
  if (
    !validId(row.id) ||
    !validId(row.ownerId) ||
    !owners.includes(row.ownerId)
  )
    return null;
  const signedAt = agreementSignedAt(row.signedAt);
  if (!signedAt) throw unavailable(); // Do not present malformed owned evidence as no signed record.
  const storedText = source === "join" || source === "prospect";
  const snapshot = safeAgreementSnapshot(storedText ? row.snapshot : null);
  const signatureImage = safeAgreementSignature(
    row.signature,
    source === "legacy" || source === "prospect"
  );
  const versionDocumentUrl =
    source === "terms" ? safeAgreementStorageUrl(row.versionDocumentUrl) : null;
  return {
    source,
    id: row.id,
    reference: `JLT-${source.toUpperCase()}-${row.id}`,
    title:
      source === "terms"
        ? "Updated agency terms"
        : source === "legacy"
          ? "Agency agreement (legacy record)"
          : source === "join" && row.membershipType === "team_member"
            ? "Team agency agreement"
            : "Agency agreement",
    signerName: stringOrNull(row.signerName),
    signedAt,
    versionLabel: source === "terms" ? stringOrNull(row.versionLabel) : null,
    snapshotAvailable: snapshot.html !== null,
    snapshotKind: snapshot.kind,
    signatureAvailable: signatureImage !== null,
    versionDocumentAvailable: versionDocumentUrl !== null,
    historicalAccount: row.ownerId !== currentId,
    signerAddress: source === "terms" ? null : stringOrNull(row.signerAddress),
    signatureImage,
    snapshotHtml: snapshot.html,
    consentConfirmed:
      storedText && (row.consent === true || row.consent === 1)
        ? true
        : storedText && (row.consent === false || row.consent === 0)
          ? false
          : null,
    signingIpRecorded: flag(row.signingIpRecorded),
    signingDeviceRecorded:
      source !== "legacy" && flag(row.signingDeviceRecorded),
    storedHash: storedText ? safeAgreementStoredHash(row.storedHash) : null,
    versionDocumentUrl,
  };
}

function summary(detail: MyAgreementDetail): MyAgreementSummary {
  const {
    source,
    id,
    reference,
    title,
    signerName,
    signedAt,
    versionLabel,
    snapshotAvailable,
    snapshotKind,
    signatureAvailable,
    versionDocumentAvailable,
    historicalAccount,
  } = detail;
  return {
    source,
    id,
    reference,
    title,
    signerName,
    signedAt,
    versionLabel,
    snapshotAvailable,
    snapshotKind,
    signatureAvailable,
    versionDocumentAvailable,
    historicalAccount,
  };
}

async function withOwnedRecords<T>(
  currentId: number,
  read: (db: Database, ids: number[]) => Promise<T>
): Promise<T> {
  try {
    const db = await getDb();
    if (!db) throw unavailable();
    const ids = await ownedIds(db, currentId);
    return await read(db, ids);
  } catch (error) {
    // Do not retain raw SQL, parameters, DB messages or causes in transport errors.
    if (
      error instanceof TRPCError &&
      error.code === "FORBIDDEN" &&
      [
        "A current account is required",
        "Archived accounts cannot access agreement records",
      ].includes(error.message)
    ) {
      throw new TRPCError({ code: "FORBIDDEN", message: error.message });
    }
    if (
      error instanceof TRPCError &&
      error.code === "NOT_FOUND" &&
      error.message === "Agreement record not found"
    )
      throw notFound();
    throw unavailable();
  }
}

export async function myAgreementSummaries(
  currentId: number
): Promise<MyAgreementSummary[]> {
  return withOwnedRecords(currentId, async (db, ids) => {
    const groups = await Promise.all(
      AGREEMENT_SOURCES.map(async source => {
        const rows = await readRows(db, ids, source);
        return rows
          .map(row => detailFromRow(row, source, currentId, ids))
          .filter((row): row is MyAgreementDetail => row !== null);
      })
    );
    // Newest first; explicit source order and descending ID make equal-time ordering deterministic.
    return groups
      .flat()
      .sort(
        (a, b) =>
          b.signedAt.localeCompare(a.signedAt) ||
          AGREEMENT_SOURCES.indexOf(a.source) -
            AGREEMENT_SOURCES.indexOf(b.source) ||
          b.id - a.id
      )
      .map(summary);
  });
}

export async function myAgreementDetail(
  currentId: number,
  source: AgreementSource,
  id: number
): Promise<MyAgreementDetail> {
  return withOwnedRecords(currentId, async (db, ids) => {
    const rows = await readRows(db, ids, source, id);
    const row = rows.find(row => row.id === id);
    const detail = row ? detailFromRow(row, source, currentId, ids) : null;
    if (!detail) throw notFound();
    return detail;
  });
}
