export const AGREEMENT_SOURCES = [
  "join",
  "prospect",
  "legacy",
  "terms",
] as const;
export type AgreementSource = (typeof AGREEMENT_SOURCES)[number];

export type MyAgreementSummary = {
  source: AgreementSource;
  id: number;
  reference: string;
  title: string;
  signerName: string | null;
  signedAt: string;
  versionLabel: string | null;
  snapshotAvailable: boolean;
  snapshotKind: "document_reference" | "text_snapshot" | null;
  signatureAvailable: boolean;
  versionDocumentAvailable: boolean;
  historicalAccount: boolean;
};

export type MyAgreementDetail = MyAgreementSummary & {
  signerAddress: string | null;
  signatureImage: string | null;
  snapshotHtml: string | null;
  consentConfirmed: boolean | null;
  signingIpRecorded: boolean;
  signingDeviceRecorded: boolean;
  storedHash: string | null;
  versionDocumentUrl: string | null;
};
