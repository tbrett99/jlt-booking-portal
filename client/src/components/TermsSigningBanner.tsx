import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, FileSignature, CheckCircle2, Pen, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import SignatureCanvas from "react-signature-canvas";

const TERMS_SUMMARY = `By signing below, you confirm that you have read and understood the updated JLT Group Membership Agreement (including all Appendices) in full, and you agree to be bound by its terms and conditions, effective 30 days from the date of verbal notice (12 May 2026).

Key updates in this version include:
• Section 26.4.1 — Commission Eligibility Conditions: Commission may only be claimed when (a) the client has paid in full, (b) all suppliers have been paid in full, and (c) the departure date is no more than 12 weeks away.
• Section 5.3.1 — Fair Dealing: Agents must treat clients fairly and honestly at all times and must not deceive clients regarding the terms of their booking.

The full updated terms are available in the Terms & Policies section of the portal.`;

export function TermsSigningBanner() {
  const { user } = useAuth();
  const sigRef = useRef<SignatureCanvas>(null);
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

  const handleSign = () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      toast.error("Please draw your signature in the box.");
      return;
    }
    if (!signedName.trim()) {
      toast.error("Please type your full name.");
      return;
    }
    if (!agreed) {
      toast.error("Please tick the confirmation checkbox.");
      return;
    }
    const signatureImage = sigRef.current.getTrimmedCanvas().toDataURL("image/png");
    signMutation.mutate({
      signedName: signedName.trim(),
      signatureImage,
      signingUserAgent: navigator.userAgent,
    });
  };

  return (
    <>
      {/* Persistent banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
        <p className="text-sm text-amber-800 flex-1">
          <strong>Updated Terms & Conditions</strong> — Our membership agreement has been updated
          {deadline ? ` and must be acknowledged by ${deadline}` : ""}. Please review and sign at your earliest convenience.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100"
          onClick={() => setModalOpen(true)}
        >
          <FileSignature className="h-3.5 w-3.5 mr-1.5" />
          Review & Sign
        </Button>
      </div>

      {/* Signing modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
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

          <ScrollArea className="flex-1 px-6 py-4">
            <div className="space-y-5">
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
                />
              </div>

              {/* Signature canvas */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-sm font-medium">
                    <Pen size={14} />
                    Your Signature <span className="text-red-500">*</span>
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => sigRef.current?.clear()}
                    className="text-xs h-7"
                  >
                    <RotateCcw size={12} className="mr-1" />
                    Clear
                  </Button>
                </div>
                <div className="border-2 border-dashed rounded-lg overflow-hidden bg-gray-50">
                  <SignatureCanvas
                    ref={sigRef}
                    penColor="#1a2a3a"
                    canvasProps={{ className: "w-full", height: 140 }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Draw your signature using your mouse or touchscreen.
                </p>
              </div>

              {/* Agreement checkbox */}
              <div className="flex items-start gap-3 border rounded-lg p-4 bg-muted/30">
                <Checkbox
                  id="agree-terms"
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(!!v)}
                  className="mt-0.5"
                />
                <Label htmlFor="agree-terms" className="text-sm font-normal cursor-pointer leading-relaxed">
                  I confirm that I have read and understood the updated JLT Group Membership Agreement in full,
                  and I agree to be bound by its terms and conditions.
                </Label>
              </div>
            </div>
          </ScrollArea>

          <div className="px-6 py-4 border-t flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Remind me later
            </Button>
            <Button
              onClick={handleSign}
              disabled={signMutation.isPending || !signedName.trim() || !agreed}
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
        </DialogContent>
      </Dialog>
    </>
  );
}
