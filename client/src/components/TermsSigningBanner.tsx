import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, FileSignature, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

const TERMS_SUMMARY = `By signing below, you confirm that you have read and understood the updated JLT Group Membership Agreement (including all Appendices) in full, and you agree to be bound by its terms and conditions, effective 30 days from the date of verbal notice (12 May 2026).

Key updates in this version include:
• Section 43 — Minimum Margin: Updated to 6% gross (including VAT on commission). Each agent receives two Family & Friends vouchers annually permitting sales below this threshold.
• Section 26.4.1 — Commission Eligibility: Commission may only be claimed when the client has paid in full, all suppliers have been paid, and departure is no more than 12 weeks away.
• Section 9.2.1 — Data Protection: Agents must register with the ICO as a data controller.

The full updated terms are available in the Terms & Policies section of the portal.`;

export function TermsSigningBanner() {
  const { user } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signed, setSigned] = useState(false);

  const { data: status, isLoading } = trpc.terms.getStatus.useQuery(undefined, {
    enabled: !!user && user.role === "agent",
  });

  const signMutation = trpc.terms.sign.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setSigned(true);
        setModalOpen(false);
        toast.success("Thank you — your signature has been recorded.");
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to record signature. Please try again.");
    },
  });

  // Only show for agents
  if (!user || user.role !== "agent") return null;
  if (isLoading) return null;
  if (!status?.hasActiveTerm) return null;
  if (status.hasSigned || signed) return null;

  const deadline = status.activeVersion?.deadline
    ? new Date(status.activeVersion.deadline).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const canSign = signedName.trim().length >= 2 && agreed;

  const handleSign = () => {
    if (!signedName.trim() || signedName.trim().length < 2) {
      toast.error("Please type your full name.");
      return;
    }
    if (!agreed) {
      toast.error("Please tick the confirmation checkbox.");
      return;
    }
    signMutation.mutate({
      signedName: signedName.trim(),
      signatureImage: undefined,
      signingUserAgent: navigator.userAgent,
    });
  };

  return (
    <>
      {/* Persistent banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
        <p className="text-sm text-amber-800 flex-1">
          <strong>Action Required: Updated Terms & Conditions</strong> — Our membership agreement has been updated
          {deadline ? ` and must be acknowledged by ${deadline}` : ""}. Please review and sign.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100 bg-amber-50"
          onClick={() => setModalOpen(true)}
        >
          <FileSignature className="h-3.5 w-3.5 mr-1.5" />
          Review & Sign
        </Button>
      </div>

      {/* Signing modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl w-full">
          <DialogHeader className="border-b pb-4">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <FileSignature className="h-5 w-5 text-primary" />
              Updated Membership Agreement — {status.activeVersion?.versionLabel}
            </DialogTitle>
            {deadline && (
              <p className="text-sm text-muted-foreground mt-1">
                Please sign by <strong>{deadline}</strong>
              </p>
            )}
          </DialogHeader>

          <div className="space-y-5 py-2 max-h-[70vh] overflow-y-auto pr-1">
            {/* Terms summary */}
            <div className="bg-muted/50 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-line">
              {TERMS_SUMMARY}
            </div>

            <p className="text-sm text-muted-foreground">
              You can read the full updated terms in the{" "}
              <a href="/terms" className="underline text-primary" target="_blank" rel="noopener noreferrer">
                Terms &amp; Policies
              </a>{" "}
              section of the portal.
            </p>

            {/* Full name */}
            <div className="space-y-1.5">
              <Label htmlFor="signedName" className="text-sm font-medium">
                Full name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="signedName"
                placeholder="Type your full legal name"
                value={signedName}
                onChange={(e) => setSignedName(e.target.value)}
                className="max-w-sm"
                autoComplete="name"
              />
              {signedName.length > 0 && signedName.trim().length < 2 && (
                <p className="text-xs text-red-500">Please enter your full name</p>
              )}
            </div>

            {/* Agreement checkbox */}
            <div className="flex items-start gap-3 border rounded-lg p-4 bg-muted/30">
              <Checkbox
                id="agree-terms"
                checked={agreed}
                onCheckedChange={(v) => setAgreed(!!v)}
                className="mt-0.5 shrink-0"
              />
              <Label htmlFor="agree-terms" className="text-sm font-normal cursor-pointer leading-relaxed">
                I confirm that I have read and understood the updated JLT Group Membership Agreement in full,
                and I agree to be bound by its terms and conditions.
              </Label>
            </div>

            {/* Sign button — inside the scroll area so it's always visible */}
            <div className="flex justify-end gap-3 pt-2 border-t">
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Remind me later
              </Button>
              <Button
                onClick={handleSign}
                disabled={signMutation.isPending || !canSign}
                className="min-w-[140px]"
              >
                {signMutation.isPending ? (
                  "Signing…"
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    Confirm &amp; Sign
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
