import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  FileText,
  ShieldCheck,
  Printer,
  ExternalLink,
} from "lucide-react";
import { agreementLocalDate } from "@/components/MySignedAgencyTerms";
import MyPolicyDocuments from "@/components/MyPolicyDocuments";
import { printMyAgreement } from "@/lib/print-my-agreement";
import { toast } from "sonner";
import type {
  MyAgreementDetail,
  MyAgreementSummary,
} from "@shared/my-agreements";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

export function AgreementRecord({ record }: { record: MyAgreementDetail }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(
    () => setImageFailed(false),
    [record.source, record.id, record.signatureImage]
  );
  return (
    <>
      <div className="space-y-2 border-b pb-4">
        <h2 className="text-xl font-bold">{record.title}</h2>
        <Badge variant="secondary">Electronic signing record held by JLT</Badge>
        <p className="text-sm text-muted-foreground">
          JLT retains this signing record in connection with your agency
          agreement. This is a read-only view; opening or printing it does not
          sign or accept any new terms.
        </p>
        {record.historicalAccount && (
          <p className="text-xs text-muted-foreground">
            This original record was preserved when your duplicate agent
            accounts were merged.
          </p>
        )}
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label="Recorded signer">
          {record.signerName ?? "Not recorded"}
        </Field>
        <Field label="Signed on (your local time)">
          {agreementLocalDate(record.signedAt)}
        </Field>
        <Field label="Signing time (UTC)">
          <time dateTime={record.signedAt}>
            {new Date(record.signedAt).toISOString()}
          </time>
        </Field>
        <Field label="Record reference">{record.reference}</Field>
        <Field label="Address at signing">
          {record.signerAddress ?? "Not recorded"}
        </Field>
        <Field label="Version label">
          {record.versionLabel ?? "Not recorded — see record reference"}
        </Field>
        <Field label="Consent checkbox">
          {record.consentConfirmed === true
            ? "Recorded as confirmed at signing"
            : "Not recorded as confirmed in this record"}
        </Field>
      </dl>
      <section className="space-y-2" aria-label="Recorded electronic signature">
        <h3 className="text-sm font-semibold">Recorded electronic signature</h3>
        {record.signatureImage && !imageFailed ? (
          <div className="rounded-lg border bg-white p-3">
            <img
              src={record.signatureImage}
              alt={`Recorded signature of ${record.signerName ?? "the signatory"}`}
              referrerPolicy="no-referrer"
              className="max-h-28 max-w-full object-contain"
              onError={() => setImageFailed(true)}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {imageFailed
              ? "The recorded signature image could not be loaded. The signing record remains available; contact support for help with the image."
              : "A displayable signature image is not available in this record. Other recorded signing details are shown above."}
          </p>
        )}
      </section>
      <section className="space-y-3" aria-label="Agency terms at signing">
        <h3 className="text-base font-semibold">Saved signing content</h3>
        {record.snapshotHtml ? (
          <>
            <p className="text-sm font-medium">
              {record.snapshotKind === "document_reference"
                ? "Document reference recorded at signing"
                : "Text saved with this signing record"}
            </p>
            <p className="text-xs text-muted-foreground">
              This is the saved signing content, not a replacement with today's
              terms. Some records contain an acknowledgement and a link to a
              document rather than the full agreement text. A saved link does
              not verify that the linked file is unchanged since signing. Unsafe
              embedded content is excluded from this display; the stored
              original is unchanged.
            </p>
            <div
              className="prose prose-sm max-w-none overflow-x-auto rounded-lg border bg-card p-4 [&_table]:w-full [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2 [&_a]:text-teal-700"
              dangerouslySetInnerHTML={{ __html: record.snapshotHtml }}
            />
          </>
        ) : (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-semibold">
              Signing-time text snapshot not available
            </p>
            <p className="text-sm text-muted-foreground">
              This record does not contain a saved copy of the exact wording
              displayed when it was signed. Today's terms are not substituted
              here.
            </p>
            {record.versionDocumentUrl && (
              <div className="space-y-1">
                <a
                  href={record.versionDocumentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-2 text-sm font-medium underline underline-offset-2"
                >
                  <ExternalLink size={14} /> Open document linked to this
                  version
                </a>
                <p className="text-xs text-muted-foreground">
                  This is the document currently linked to the recorded version,
                  not a separately captured signing-time snapshot.
                </p>
              </div>
            )}
            <p className="text-sm">
              For a copy of your original agreement, contact{" "}
              <a
                className="underline underline-offset-2"
                href="mailto:support@thejltgroup.co.uk"
              >
                support@thejltgroup.co.uk
              </a>
              .
            </p>
          </div>
        )}
      </section>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Signing evidence details
        </summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="IP address evidence">
            {record.signingIpRecorded ? "Recorded by JLT" : "Not recorded"}
          </Field>
          <Field label="Browser / device evidence">
            {record.signingDeviceRecorded ? "Recorded by JLT" : "Not recorded"}
          </Field>
        </dl>
        {record.storedHash ? (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">
              Stored SHA-256 integrity reference (not re-verified by this view)
            </p>
            <pre className="mt-1 whitespace-pre-wrap break-all text-xs">
              {record.storedHash}
            </pre>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            No stored integrity hash is available for this record.
          </p>
        )}
      </details>
    </>
  );
}

function SelectedAgreement({ item }: { item: MyAgreementSummary }) {
  const { data, isLoading, isError, refetch } =
    trpc.myAgreements.detail.useQuery(
      { source: item.source, id: item.id },
      { staleTime: 60_000 }
    );
  const article = useRef<HTMLElement>(null);
  const [printing, setPrinting] = useState(false);
  const matching = data?.source === item.source && data.id === item.id;
  const print = async () => {
    if (!article.current || !matching || isError || printing) return;
    setPrinting(true);
    try {
      await printMyAgreement(article.current);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Printing could not be opened."
      );
    } finally {
      setPrinting(false);
    }
  };
  if (isLoading)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading your signing record…
      </p>
    );
  if (isError || !data || data.source !== item.source || data.id !== item.id)
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This agreement record could not be loaded. No signing data has been
          changed.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry signing record
        </Button>
      </div>
    );
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => void print()}
          disabled={printing}
        >
          <Printer size={14} />{" "}
          {printing ? "Preparing print…" : "Print record / Save PDF"}
        </Button>
      </div>
      <article ref={article} className="space-y-5">
        <AgreementRecord record={data} />
      </article>
    </div>
  );
}

export default function MyAgreements() {
  const { data, isLoading, isError, refetch } = trpc.myAgreements.mine.useQuery(
    undefined,
    { staleTime: 60_000 }
  );
  const [selected, setSelected] = useState<string | null>(null);
  const item =
    data?.find(record => `${record.source}:${record.id}` === selected) ??
    data?.[0];
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <Button asChild variant="ghost" size="sm" className="gap-2">
        <Link href="/dashboard">
          <ArrowLeft size={14} /> Back to dashboard
        </Link>
      </Button>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck size={23} /> Agreements &amp; Policies
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your agency agreement, signing record and current JLT policy documents
          in one place.
        </p>
      </div>
      <MyPolicyDocuments />
      <div>
        <h2 className="text-lg font-semibold">Your signed agency agreement</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your recorded electronic signing history and available agreement
          content or document references. Current published policies above do
          not replace the wording saved at signing.
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading your agreement records…
        </p>
      ) : isError ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Your agreement records could not be loaded. This does not mean there
            is no signed record.
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry agreement records
          </Button>
        </div>
      ) : !item ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <FileText size={22} className="text-muted-foreground" />
            <h2 className="font-semibold">
              No signed record linked to this account
            </h2>
            <p className="text-sm text-muted-foreground">
              You may have signed outside the Portal. This does not mean no
              agreement exists. Contact{" "}
              <a href="mailto:support@thejltgroup.co.uk" className="underline">
                support@thejltgroup.co.uk
              </a>{" "}
              for your original copy.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {data && data.length > 1 && (
            <div className="space-y-2">
              <label
                htmlFor="my-agreement-record"
                className="text-sm font-semibold"
              >
                Choose a signing record
              </label>
              <select
                id="my-agreement-record"
                value={`${item.source}:${item.id}`}
                onChange={event => setSelected(event.target.value)}
                className="w-full rounded-lg border bg-background p-2.5 text-sm"
              >
                {data.map(record => (
                  <option
                    key={`${record.source}:${record.id}`}
                    value={`${record.source}:${record.id}`}
                  >
                    {record.title} · {agreementLocalDate(record.signedAt)} ·{" "}
                    {record.reference}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Card>
            <CardContent className="pt-5">
              <SelectedAgreement
                key={`${item.source}:${item.id}`}
                item={item}
              />
            </CardContent>
          </Card>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        <Link href="/terms" className="underline underline-offset-2">
          General Terms &amp; Policies
        </Link>{" "}
        are available separately and are not a substitute for your personal
        signing record.
      </p>
    </div>
  );
}
