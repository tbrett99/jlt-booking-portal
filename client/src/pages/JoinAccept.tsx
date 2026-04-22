/**
 * JoinAccept — Team member invite acceptance page
 * Accessed via /join/accept?token=<invite_token>
 *
 * Flow:
 *  1. Load invite details from token
 *  2. Sign contract (PDF + canvas signature + typed name + address)
 *  3. Confirmation
 */

import React, { useRef, useState } from "react";
import { useSearch } from "wouter";
import SignatureCanvas from "react-signature-canvas";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

export default function JoinAccept() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token") ?? "";

  const { user } = useAuth();
  const sigRef = useRef<SignatureCanvas>(null);
  const [signerName, setSignerName] = useState("");
  const [signerAddress, setSignerAddress] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const { data: invite, isLoading: inviteLoading, error: inviteError } = trpc.join.getInvite.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );
  const { data: template, isLoading: templateLoading } = trpc.join.getContractTemplate.useQuery(
    undefined,
    { enabled: !!invite }
  );

  const acceptMutation = trpc.join.acceptInvite.useMutation();

  const clearSignature = () => {
    sigRef.current?.clear();
    setHasDrawn(false);
  };

  const handleAccept = async () => {
    if (!user) {
      toast.error("Please log in to accept this invitation.");
      return;
    }
    const newErrors: Record<string, string> = {};
    if (!hasDrawn || sigRef.current?.isEmpty()) {
      newErrors.signature = "Please draw your signature";
    }
    if (!signerName.trim() || signerName.trim().length < 2) {
      newErrors.name = "Please enter your full name";
    }
    if (!signerAddress.trim() || signerAddress.trim().length < 5) {
      newErrors.address = "Please enter your full address";
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    const signatureDataUrl = sigRef.current!.toDataURL("image/png");

    try {
      await acceptMutation.mutateAsync({
        token,
        sessionToken: token, // reuse token as session identifier for team member
        signatureDataUrl,
        signerName: signerName.trim(),
        signerAddress: signerAddress.trim(),
        userId: user.id,
      });
      setDone(true);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to accept invitation");
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFF6ED" }}>
        <div className="text-center p-8">
          <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-[#414141]">Invalid Link</h1>
          <p className="text-gray-500 text-sm mt-2">This invite link is missing a token. Please check your email.</p>
        </div>
      </div>
    );
  }

  if (inviteLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFF6ED" }}>
        <Loader2 className="animate-spin text-[#70FFE8]" size={32} />
      </div>
    );
  }

  if (inviteError || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFF6ED" }}>
        <div className="text-center p-8 max-w-sm">
          <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-[#414141]">Invite Not Found</h1>
          <p className="text-gray-500 text-sm mt-2">
            {(inviteError as any)?.message ?? "This invite link is invalid or has expired. Please contact your team leader."}
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFF6ED" }}>
        <div className="text-center p-8 max-w-sm space-y-4">
          <div className="w-20 h-20 rounded-full mx-auto flex items-center justify-center" style={{ background: "#70FFE8" }}>
            <CheckCircle2 size={40} className="text-[#414141]" />
          </div>
          <h1 className="text-2xl font-bold text-[#414141]">Welcome to JLT Group!</h1>
          <p className="text-gray-500 text-sm">
            You've successfully joined {invite.teamName}. The JLT team will activate your portal access shortly.
          </p>
          <p className="text-xs text-gray-400">
            Questions? Email{" "}
            <a href="mailto:memberships@thejltgroup.co.uk" className="text-[#02E6D2] underline">
              memberships@thejltgroup.co.uk
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#FFF6ED" }}>
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="max-w-xl mx-auto flex items-center gap-2">
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "#70FFE8" }}>
            <span className="font-bold text-[#414141] text-xs">JLT</span>
          </div>
          <span className="font-semibold text-[#414141]">JLT Group — Team Invitation</span>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-6 py-8 space-y-6">
        {/* Invite info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h1 className="text-xl font-bold text-[#414141] mb-1">You've been invited!</h1>
          <p className="text-gray-500 text-sm">
            <strong>{invite.leaderName}</strong> has invited you to join their{" "}
            <strong>{invite.teamName}</strong> membership.
          </p>
          {!user && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <strong>Note:</strong> You need to be logged in to accept this invitation. Please{" "}
              <a href="/login" className="underline">log in</a> or{" "}
              <a href="/register" className="underline">create an account</a> first.
            </div>
          )}
        </div>

        {/* Contract */}
        {templateLoading ? (
          <div className="flex items-center justify-center h-48 bg-gray-50 rounded-xl">
            <Loader2 className="animate-spin text-[#70FFE8]" size={28} />
          </div>
        ) : template ? (
          <div className="rounded-xl overflow-hidden border border-gray-200">
            <div className="bg-gray-50 px-4 py-2 text-xs text-gray-500 border-b border-gray-200">
              {template.name} — scroll to read the full contract
            </div>
            <iframe
              src={template.pdfUrl}
              className="w-full"
              style={{ height: "400px" }}
              title="JLT Group Membership Contract"
            />
          </div>
        ) : null}

        {/* Signature */}
        <div>
          <Label className="text-sm font-semibold text-[#414141] mb-2 block">
            Draw your signature <span className="text-red-500">*</span>
          </Label>
          <div
            className={`border-2 rounded-xl overflow-hidden bg-white ${
              errors.signature ? "border-red-400" : "border-gray-300"
            }`}
          >
            <SignatureCanvas
              ref={sigRef}
              canvasProps={{ width: 600, height: 160, className: "w-full" }}
              penColor="#414141"
              onBegin={() => setHasDrawn(true)}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            {errors.signature ? (
              <p className="text-xs text-red-500">{errors.signature}</p>
            ) : (
              <p className="text-xs text-gray-400">Draw your signature using your mouse or finger</p>
            )}
            <button onClick={clearSignature} className="text-xs text-gray-400 hover:text-gray-600 underline">
              Clear
            </button>
          </div>
        </div>

        {/* Full name */}
        <div>
          <Label htmlFor="signerName" className="text-sm font-semibold text-[#414141] mb-1 block">
            Full legal name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="signerName"
            placeholder="Your full name as it appears on your ID"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            className={errors.name ? "border-red-400" : ""}
          />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
        </div>

        {/* Address */}
        <div>
          <Label htmlFor="signerAddress" className="text-sm font-semibold text-[#414141] mb-1 block">
            Home address <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="signerAddress"
            placeholder={"123 Example Street\nCity\nPostcode"}
            value={signerAddress}
            onChange={(e) => setSignerAddress(e.target.value)}
            rows={3}
            className={errors.address ? "border-red-400" : ""}
          />
          {errors.address && <p className="text-xs text-red-500 mt-1">{errors.address}</p>}
        </div>

        <div className="bg-[#FFF6ED] border border-[#70FFE8]/30 rounded-xl p-4 text-xs text-gray-500">
          By signing above, you confirm you have read and agree to the JLT Group Membership Agreement. Your signature and details will be stored securely.
        </div>

        <Button
          onClick={handleAccept}
          disabled={acceptMutation.isPending || !user}
          className="w-full h-12 text-base font-semibold"
          style={{ background: "#70FFE8", color: "#414141" }}
        >
          {acceptMutation.isPending ? (
            <><Loader2 className="animate-spin mr-2" size={18} /> Saving...</>
          ) : (
            <>Sign & Accept Invitation <CheckCircle2 size={18} className="ml-1" /></>
          )}
        </Button>
      </div>
    </div>
  );
}
