import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, ShieldCheck, ArrowRight } from "lucide-react";

export function agreementLocalDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default function MySignedAgencyTerms() {
  const { data, isLoading, isError, refetch } = trpc.myAgreements.mine.useQuery(
    undefined,
    { staleTime: 60_000 }
  );
  const latest = data?.[0];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck size={17} /> My signed agency terms
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading your agreement records…
          </p>
        ) : isError ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Your agreement records could not be loaded. This does not mean
              there is no signed record.
            </p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Retry agreement records
            </Button>
          </div>
        ) : latest ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Signing record held by JLT</Badge>
              <span className="text-xs text-muted-foreground">
                {data?.length ?? 0} record{data?.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-sm">
              <span className="font-semibold">
                {latest.signerName ?? "Name not recorded"}
              </span>{" "}
              · {agreementLocalDate(latest.signedAt)}
            </p>
            <p className="text-sm text-muted-foreground">
              View the available agreement content and electronic signing
              details recorded for your account. This is separate from the
              general Terms &amp; Policies page.
            </p>
            {!latest.snapshotAvailable && (
              <p className="text-xs text-muted-foreground">
                The latest record has no signing-time text snapshot. Any
                available version document is labelled separately.
              </p>
            )}
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/my-agreements">
                <FileText size={14} /> View my agreement records{" "}
                <ArrowRight size={14} />
              </Link>
            </Button>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              No signed agreement record is linked to this Portal account. You
              may have signed outside the Portal; this does not mean no
              agreement exists.
            </p>
            <p className="text-sm">
              For a copy, contact{" "}
              <a
                href="mailto:support@thejltgroup.co.uk"
                className="underline underline-offset-2"
              >
                support@thejltgroup.co.uk
              </a>
              .
            </p>
          </div>
        )}
        <Link
          href="/terms"
          className="inline-block text-xs text-muted-foreground underline underline-offset-2"
        >
          General Terms &amp; Policies (not your personal signing record)
        </Link>
      </CardContent>
    </Card>
  );
}
