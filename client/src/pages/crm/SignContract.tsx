import { useRef, useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CheckCircle, Pen, RotateCcw, ArrowRight, Loader2, CreditCard } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";

export default function SignContract() {
  const { token } = useParams<{ token: string }>();
  const sigRef = useRef<SignatureCanvas>(null);
  const [agreed, setAgreed] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerAddress, setSignerAddress] = useState("");
  const [signed, setSigned] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const { data: contract, isLoading, error } = trpc.crm.contracts.getByToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false }
  );

  const signMutation = trpc.crm.contracts.sign.useMutation({
    onSuccess: (data) => {
      setSigned(true);
      if (data.hasPaymentUrl && data.redirectUrl) {
        setPaymentUrl(data.redirectUrl);
        // Auto-redirect after 3 seconds
        setRedirecting(true);
        setTimeout(() => {
          window.location.href = data.redirectUrl;
        }, 3000);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSign = () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      toast.error("Please provide your signature");
      return;
    }
    if (!signerName.trim()) {
      toast.error("Please enter your full name");
      return;
    }
    if (!signerAddress.trim()) {
      toast.error("Please enter your address");
      return;
    }
    if (!agreed) {
      toast.error("Please confirm you have read and agree to the contract");
      return;
    }
    const signatureDataUrl = sigRef.current.getTrimmedCanvas().toDataURL("image/png");
    signMutation.mutate({
      token: token ?? "",
      signerName: signerName.trim(),
      signerAddress: signerAddress.trim(),
      signatureDataUrl,
      origin: window.location.origin,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a2a3a] to-[#0d1a26]">
        <div className="text-white text-sm">Loading contract…</div>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a2a3a] to-[#0d1a26] p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center space-y-3">
          <h2 className="text-xl font-bold text-destructive">Link Invalid or Expired</h2>
          <p className="text-muted-foreground text-sm">{error?.message ?? "This contract link is not valid. Please contact JLT Group for a new link."}</p>
        </div>
      </div>
    );
  }

  if (signed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a2a3a] to-[#0d1a26] p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Contract Signed!</h2>
            <p className="text-muted-foreground text-sm mt-2">
              Your contract has been signed and stored securely. A confirmation email has been sent to you.
            </p>
          </div>

          {paymentUrl ? (
            <div className="space-y-4">
              <div className="bg-[#f0fff9] border border-[#70FFE8]/40 rounded-xl p-4">
                <p className="text-sm font-semibold text-gray-800 mb-1">Next step: Pay your joining fee</p>
                <p className="text-xs text-gray-500">
                  {redirecting
                    ? "Redirecting you to payment in a moment…"
                    : "Click below to complete your joining fee payment of £297."}
                </p>
              </div>

              {redirecting ? (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={16} className="animate-spin" />
                  Redirecting to payment…
                </div>
              ) : (
                <a href={paymentUrl}>
                  <Button
                    className="w-full font-semibold"
                    style={{ background: "#70FFE8", color: "#414141" }}
                    size="lg"
                  >
                    <CreditCard size={18} className="mr-2" />
                    Pay Joining Fee — £297
                    <ArrowRight size={16} className="ml-2" />
                  </Button>
                </a>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              You'll receive an email shortly with your next steps, including how to pay your joining fee.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a2a3a] to-[#0d1a26] p-4 flex items-start justify-center py-12">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-4 border-b">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0"
              style={{ background: "#70FFE8", color: "#414141" }}
            >
              JLT
            </div>
            <div>
              <h1 className="text-2xl font-bold">JLT Group — Agent Contract</h1>
              <p className="text-muted-foreground text-sm">Please read the contract below carefully, then complete the form and sign to proceed.</p>
            </div>
          </div>
        </div>

        {/* Contract PDF viewer */}
        {contract.templatePdfUrl ? (
          <div className="px-8 py-4">
            <p className="text-sm font-medium mb-2">Contract Document</p>
            <div className="border rounded-lg overflow-hidden" style={{ height: "500px" }}>
              <iframe src={contract.templatePdfUrl} className="w-full h-full" title="Contract" />
            </div>
            <a href={contract.templatePdfUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary mt-1 inline-block">Open in new tab</a>
          </div>
        ) : (
          <div className="px-8 py-4">
            <div className="border rounded-lg p-6 bg-muted/30 text-center text-muted-foreground text-sm">
              Contract document will be available here once uploaded by the JLT Group team.
            </div>
          </div>
        )}

        {/* Signing form */}
        <div className="px-8 pb-8 space-y-5">
          <div className="border-t pt-5">
            <h2 className="text-lg font-semibold mb-4">Your Details</h2>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Full Legal Name *</Label>
                <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="As it appears on your ID" />
              </div>
              <div className="space-y-1.5">
                <Label>Full Address *</Label>
                <Textarea rows={3} value={signerAddress} onChange={(e) => setSignerAddress(e.target.value)} placeholder="House number, street, city, postcode" />
              </div>
            </div>
          </div>

          {/* Signature */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Pen size={14} />Your Signature *</Label>
              <Button variant="ghost" size="sm" onClick={() => sigRef.current?.clear()} className="text-xs h-7">
                <RotateCcw size={12} className="mr-1" />Clear
              </Button>
            </div>
            <div className="border-2 border-dashed rounded-lg overflow-hidden bg-gray-50">
              <SignatureCanvas
                ref={sigRef}
                penColor="#1a2a3a"
                canvasProps={{ className: "w-full", height: 160 }}
              />
            </div>
            <p className="text-xs text-muted-foreground">Draw your signature in the box above using your mouse or touchscreen.</p>
          </div>

          {/* Agreement */}
          <div className="flex items-start gap-2.5 border rounded-lg p-4 bg-muted/30">
            <Checkbox id="agree" checked={agreed} onCheckedChange={(v) => setAgreed(!!v)} className="mt-0.5" />
            <Label htmlFor="agree" className="text-sm font-normal cursor-pointer">
              I confirm that I have read and understood the JLT Group Agent Contract in full, and I agree to be bound by its terms and conditions. I confirm that the name and address I have provided are accurate.
            </Label>
          </div>

          {/* Next step info */}
          <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg p-3">
            <CreditCard size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-blue-700">
              After signing, you'll be redirected to pay your <strong>joining fee of £297</strong> to complete your membership.
            </p>
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={handleSign}
            disabled={signMutation.isPending || !signerName || !signerAddress || !agreed}
          >
            {signMutation.isPending ? (
              <><Loader2 size={16} className="animate-spin mr-2" />Signing…</>
            ) : (
              <>Sign & Proceed to Payment<ArrowRight size={16} className="ml-2" /></>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
