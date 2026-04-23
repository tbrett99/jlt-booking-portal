import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Shield,
  CheckCircle2,
  AlertCircle,
  Printer,
  ArrowLeft,
  Clock,
  Globe,
  Monitor,
  Hash,
  User,
  MapPin,
  FileText,
} from "lucide-react";
import { Link } from "wouter";

function EvidenceField({
  icon: Icon,
  label,
  value,
  mono = false,
  className = "",
}: {
  icon: React.ElementType;
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex gap-3 py-3 ${className}`}>
      <div className="mt-0.5 shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
          {label}
        </p>
        {value ? (
          <p className={`text-sm break-all ${mono ? "font-mono text-xs" : ""}`}>
            {value}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">Not recorded</p>
        )}
      </div>
    </div>
  );
}

export default function ContractEvidenceViewer() {
  const params = useParams<{ userId: string }>();
  const userId = parseInt(params.userId ?? "0", 10);

  const { data, isLoading, error } = trpc.crm.agentCrm.getContractEvidence.useQuery(
    { userId },
    { enabled: !!userId }
  );

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading contract evidence…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">No Contract Record Found</h2>
          <p className="text-muted-foreground mb-6">
            No signed contract evidence exists for this agent. They may have signed via a CRM contract
            link rather than the self-signup flow.
          </p>
          <Link href="/crm/agents">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Agents
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const signedAt = data.contractSignedAt ? new Date(data.contractSignedAt) : null;
  const hasAllEvidence =
    !!data.signerName &&
    !!data.contractSignedAt &&
    !!data.ipAddress &&
    !!data.signingUserAgent &&
    !!data.consentConfirmed &&
    !!data.contractHash;

  return (
    <div className="min-h-screen bg-background print:bg-white">
      {/* Header — hidden on print */}
      <div className="print:hidden border-b bg-card sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/crm/agents">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </Link>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm">Contract Evidence Record</span>
            </div>
          </div>
          <Button onClick={handlePrint} size="sm">
            <Printer className="h-4 w-4 mr-2" />
            Print / Save PDF
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Title block */}
        <div className="text-center space-y-2 print:mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Shield className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold">JLT Group — Contract Signing Evidence</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            This record constitutes legally admissible evidence of electronic contract execution.
            All data is stored immutably at time of signing.
          </p>
          <div className="flex items-center justify-center gap-2 mt-3">
            {hasAllEvidence ? (
              <Badge className="bg-green-500/10 text-green-700 border-green-500/30 gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Full Evidence Captured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-400 gap-1">
                <AlertCircle className="h-3.5 w-3.5" />
                Partial Evidence (signed before full audit logging was enabled)
              </Badge>
            )}
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Signatory Details */}
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              Signatory Details
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Identity of the person who executed the contract
            </p>
            <Separator className="mb-3" />
            <EvidenceField icon={User} label="Full Name (typed)" value={data.signerName} />
            <Separator />
            <EvidenceField icon={MapPin} label="Address (typed)" value={data.signerAddress} />
            <Separator />
            <EvidenceField
              icon={User}
              label="Portal Account"
              value={data.agent ? `${data.agent.name} <${data.agent.email}>` : null}
            />
            <Separator />
            <EvidenceField
              icon={FileText}
              label="Membership"
              value={
                data.membershipTier && data.membershipType
                  ? `${data.membershipTier.replace(/_/g, " ")} — ${data.membershipType}`
                  : null
              }
            />
          </div>

          {/* Signing Event */}
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Signing Event
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              When, where, and how the contract was signed
            </p>
            <Separator className="mb-3" />
            <EvidenceField
              icon={Clock}
              label="Signed At (UTC)"
              value={signedAt ? signedAt.toUTCString() : null}
            />
            <Separator />
            <EvidenceField
              icon={Clock}
              label="Signed At (Local)"
              value={signedAt ? signedAt.toLocaleString() : null}
            />
            <Separator />
            <EvidenceField icon={Globe} label="IP Address" value={data.ipAddress} />
            <Separator />
            <EvidenceField icon={Monitor} label="Browser / Device" value={data.signingUserAgent} />
            <Separator />
            <div className="flex gap-3 py-3">
              <div className="mt-0.5 shrink-0">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                  Explicit Consent
                </p>
                {data.consentConfirmed ? (
                  <Badge className="bg-green-500/10 text-green-700 border-green-500/30 gap-1 text-xs">
                    <CheckCircle2 className="h-3 w-3" />
                    Confirmed — "I agree" checkbox ticked
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-600 border-amber-400 text-xs">
                    Not recorded
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Integrity Hash */}
        <div className="rounded-lg border bg-card p-5">
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <Hash className="h-4 w-4 text-primary" />
            Tamper-Detection Integrity Hash
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            SHA-256 hash computed at signing time from: contract text + signature image + timestamp + signer name + IP address.
            Any modification to the contract record would produce a different hash, proving tampering.
          </p>
          <Separator className="mb-3" />
          {data.contractHash ? (
            <div className="bg-muted rounded p-3">
              <p className="font-mono text-xs break-all text-foreground">{data.contractHash}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Hash not available — contract was signed before integrity hashing was enabled.
            </p>
          )}
        </div>

        {/* Signature */}
        <div className="rounded-lg border bg-card p-5">
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Wet-Style Electronic Signature
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Hand-drawn signature captured on a digital canvas at time of signing.
            Stored immutably in S3 object storage.
          </p>
          <Separator className="mb-4" />
          {data.signatureDataUrl ? (
            <div className="border rounded-lg p-4 bg-white flex items-center justify-center min-h-[120px]">
              <img
                src={data.signatureDataUrl}
                alt="Electronic signature"
                className="max-h-32 max-w-full object-contain"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No signature image stored.</p>
          )}
          {signedAt && (
            <p className="text-xs text-muted-foreground mt-2 text-right">
              Signed: {signedAt.toUTCString()}
            </p>
          )}
        </div>

        {/* Contract Text Snapshot */}
        <div className="rounded-lg border bg-card p-5">
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Contract Text at Time of Signing
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Verbatim snapshot of the contract wording the signatory agreed to.
            This is frozen at the moment of signing and cannot be altered by subsequent template edits.
          </p>
          <Separator className="mb-4" />
          {data.contractTextSnapshot ? (
            <div
              className="prose prose-sm max-w-none border rounded-lg p-6 bg-white text-foreground overflow-auto max-h-[600px] print:max-h-none"
              dangerouslySetInnerHTML={{ __html: data.contractTextSnapshot }}
            />
          ) : (
            <div className="border rounded-lg p-6 bg-muted/30 text-center">
              <AlertCircle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
              <p className="text-sm font-medium">Contract snapshot not available</p>
              <p className="text-xs text-muted-foreground mt-1">
                This agent signed before full contract text capture was enabled.
                The contract template wording can be retrieved from the contract templates section.
              </p>
            </div>
          )}
        </div>

        {/* Legal Footer */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-5 text-sm space-y-2">
          <p className="font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Legal Notice
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            This electronic contract was executed in accordance with the Electronic Communications Act 2000 and
            the eIDAS Regulation (EU) 910/2014 (as retained in UK law). An electronic signature applied with
            the intent to sign a document has the same legal standing as a handwritten signature. This evidence
            record — including the IP address, timestamp, browser fingerprint, consent confirmation, and
            integrity hash — constitutes a complete audit trail suitable for use in legal proceedings.
          </p>
          <p className="text-muted-foreground text-xs">
            Record generated: {new Date().toUTCString()} &nbsp;|&nbsp; JLT Group Portal
          </p>
        </div>
      </div>
    </div>
  );
}
