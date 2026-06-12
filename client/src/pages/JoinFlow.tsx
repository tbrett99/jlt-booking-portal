/**
 * JoinFlow — Multi-step agent sign-up page
 *
 * Steps:
 *  1. plan     — Solo vs Team, then plan selection (Business / First Class)
 *  2. contract — PDF viewer + canvas signature + typed name + address
 *  3. payment  — Redirect to GoCardless hosted page
 *  4. complete — Confirmation page (shown after GC redirect back)
 */

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import SignatureCanvas from "react-signature-canvas";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, ChevronRight, Users, User, ArrowLeft, ChevronDown, ChevronUp, Star } from "lucide-react";
import { toast } from "sonner";

// ─── Membership feature data ──────────────────────────────────────────────────

const BC_HIGHLIGHTS = [
  "Full Training & Ongoing Mentorship",
  "200+ Suppliers · 80/20 Commission Split",
  "ATOL, IATA & PTS Protected",
  "Interactive Reservation System (IRS)",
  "Social Media & Business Academy",
  "Professional Indemnity Insurance",
];

const BC_FULL = [
  { section: "Core Membership", items: [
    "Full Training & Ongoing Mentorship",
    "ATOL Licensed, IATA Certified & PTS Protected",
    "Professional Indemnity & Public Liability Insurance",
    "Operate Under Your Own Brand",
    "JLT Group Email Address",
    "Industry Leading 80/20 Commission Split",
    "200+ Suppliers You Can Book Travel With",
    "Many NET Rate Suppliers (choose your own commission)",
    "Access to Travel Agent Rates for Personal Travel",
    "Weekly Co-working & Q&A Sessions",
    "Active WhatsApp Community",
  ]},
  { section: "Interactive Reservation System (IRS)", items: [
    "Search many suppliers from one login",
    "Create branded quotes & proposals from your search",
    "Book all elements in one click",
    "Dynamically package holidays in minutes",
    "Automated documents (confirmations, vouchers, ATOL certs)",
    "All branded to your business",
    "Manage your full customer journey in one platform",
    "Automatic payment reminders",
    "Integrated payment processor",
  ]},
  { section: "Social Media & Business Academy", items: [
    "Your Niche & Target Audience",
    "Your Brand & Sales Funnel",
    "Business Automation",
    "Driving Traffic — Instagram, Facebook, TikTok, Pinterest",
    "Blogging & Email Marketing",
    "Canva, Customer Service & Mindset",
  ]},
];

const FC_HIGHLIGHTS = [
  "Everything in Business Class",
  "Weekly Group Coaching Sessions",
  "Monthly 1:1 Coaching & Mentorship",
  "BRAVE Business Growth Framework",
  "Private WhatsApp Support Group",
];

const FC_FULL = [
  { section: "Everything in Business Class", items: [
    "All features from Business Class included",
  ]},
  { section: "BRAVE Coaching Programme", items: [
    "Weekly group coaching sessions",
    "Monthly private 1:1 coaching & mentorship",
    "Structured around the BRAVE framework:",
    "  Build — lay strong foundations for your business",
    "  Reach — grow your audience and online presence",
    "  Advance — sharpen your systems and sales process",
    "  Validate — win better clients with confidence",
    "  Evolve — scale, refine, and sustain long-term growth",
    "Covers online marketing, networking, Facebook Ads & more",
    "Helps you gain clarity, win better clients & follow smoother systems",
  ]},
  { section: "Private Support", items: [
    "Private WhatsApp support group",
    "Direct access to coaches between sessions",
  ]},
];

// ─── Types ────────────────────────────────────────────────────────────────────

type MembershipTier = "business_class" | "first_class";
type MembershipType = "solo" | "duo" | "trio";
type Step = "plan" | "contract" | "payment" | "complete";

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_KEY = "jlt_join_session_token";

function saveSession(token: string) {
  localStorage.setItem(SESSION_KEY, token);
}
function loadSession(): string | null {
  return localStorage.getItem(SESSION_KEY);
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function formatPounds(pence: number): string {
  return `£${(pence / 100).toFixed(0)}`;
}

// ─── PlanCards sub-component ────────────────────────────────────────────────

function PlanCards({
  pricing,
  selectedTier,
  selectedType,
  onSelect,
}: {
  pricing: any;
  selectedTier: MembershipTier;
  selectedType: MembershipType;
  onSelect: (t: MembershipTier) => void;
}) {
  const [expanded, setExpanded] = useState<MembershipTier | null>(null);

  const tiers: MembershipTier[] = ["business_class", "first_class"];

  return (
    <div className="space-y-4">
      {tiers.map((tier) => {
        const tierData = pricing?.tiers.find((t: any) => t.tier === tier);
        const typeData = tierData?.types.find((t: any) => t.type === selectedType);
        const monthlyPence = typeData?.monthlyPence ?? 0;
        const isFirst = tier === "first_class";
        const isSelected = selectedTier === tier;
        const isExpanded = expanded === tier;
        const highlights = tier === "business_class" ? BC_HIGHLIGHTS : FC_HIGHLIGHTS;
        const fullDetails = tier === "business_class" ? BC_FULL : FC_FULL;

        return (
          <div key={tier} className={`rounded-xl border-2 transition-all ${
            isSelected ? "border-[#70FFE8] bg-[#70FFE8]/8" : "border-gray-200"
          }`}>
            {/* Card header — clickable to select */}
            <button
              type="button"
              onClick={() => onSelect(tier)}
              className="w-full p-5 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-[#414141] text-lg">{tierData?.label ?? tier}</span>
                    {isFirst && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-[#FFC3BC] text-[#414141] px-2 py-0.5 rounded-full font-semibold">
                        <Star size={9} fill="currentColor" /> Most Popular
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-[#414141]">{formatPounds(monthlyPence)}</span>
                    <span className="text-sm text-gray-500">/month</span>
                    {selectedType !== "solo" && (
                      <span className="text-xs text-gray-400 ml-1">· covers your whole team</span>
                    )}
                  </div>
                </div>
                {/* Selection indicator */}
                <div className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  isSelected ? "border-[#02E6D2] bg-[#02E6D2]" : "border-gray-300"
                }`}>
                  {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </div>

              {/* Highlight bullets */}
              <div className="mt-3 grid grid-cols-1 gap-1">
                {highlights.map((h) => (
                  <div key={h} className="text-xs text-gray-600 flex items-start gap-1.5">
                    <CheckCircle2 size={12} className="text-[#02E6D2] shrink-0 mt-0.5" />
                    <span>{h}</span>
                  </div>
                ))}
              </div>
            </button>

            {/* Expand toggle */}
            <button
              type="button"
              className="w-full px-5 pb-4 flex items-center gap-1.5 text-xs text-[#02E6D2] font-medium hover:text-[#414141] transition-colors"
              onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : tier); }}
            >
              {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {isExpanded ? "Hide full details" : "See everything that's included"}
            </button>

            {/* Expanded detail panel */}
            {isExpanded && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
                {fullDetails.map((group) => (
                  <div key={group.section}>
                    <div className="text-xs font-semibold text-[#414141] uppercase tracking-wide mb-2">{group.section}</div>
                    <div className="space-y-1">
                      {group.items.map((item) => (
                        <div key={item} className={`text-xs flex items-start gap-1.5 ${
                          item.startsWith("  ") ? "ml-4 text-gray-400" : "text-gray-600"
                        }`}>
                          {!item.startsWith("  ") && <CheckCircle2 size={11} className="text-[#02E6D2] shrink-0 mt-0.5" />}
                          <span>{item.trimStart()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Plan Selection ───────────────────────────────────────────────────

function PlanStep({
  onNext,
}: {
  onNext: (tier: MembershipTier, type: MembershipType, email: string) => void;
}) {
  const [selectedType, setSelectedType] = useState<MembershipType>("solo");
  const [selectedTier, setSelectedTier] = useState<MembershipTier>("business_class");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");

  const { data: pricing, isLoading: pricingLoading } = trpc.join.getPricing.useQuery();

  const handleNext = () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }
    setEmailError("");
    onNext(selectedTier, selectedType, email);
  };

  if (pricingLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-[#70FFE8]" size={32} />
      </div>
    );
  }

  const joiningFee = pricing?.joiningFees?.[selectedType] ?? pricing?.joiningFeePence ?? 29700;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-[#414141] mb-2">Join JLT Group</h1>
        <p className="text-gray-500 text-sm">Choose your membership type and plan to get started.</p>
      </div>

      {/* Step 1: Solo or Team */}
      <div>
        <h2 className="text-lg font-semibold text-[#414141] mb-3">1. Will you be joining solo or as a team?</h2>
        <div className="grid grid-cols-3 gap-3">
          {(["solo", "duo", "trio"] as MembershipType[]).map((type) => {
            const icons = { solo: <User size={20} />, duo: <Users size={20} />, trio: <Users size={20} /> };
            const labels = { solo: "Solo", duo: "Duo", trio: "Trio" };
            const descs = {
              solo: "Just you",
              duo: "You + 1 team member",
              trio: "You + 2 team members",
            };
            return (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  selectedType === type
                    ? "border-[#70FFE8] bg-[#70FFE8]/10"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className={`mb-2 ${selectedType === type ? "text-[#02E6D2]" : "text-gray-400"}`}>
                  {icons[type]}
                </div>
                <div className="font-semibold text-[#414141] text-sm">{labels[type]}</div>
                <div className="text-xs text-gray-500">{descs[type]}</div>
              </button>
            );
          })}
        </div>
        {selectedType !== "solo" && (
          <p className="mt-2 text-xs text-[#02E6D2] bg-[#70FFE8]/10 rounded-lg px-3 py-2">
            As team leader, you pay the joining fee and monthly subscription. Team members will receive an email invite to sign their contract.
          </p>
        )}
      </div>

      {/* Step 2: Plan */}
      <div>
        <h2 className="text-lg font-semibold text-[#414141] mb-3">2. Choose your plan</h2>
        <PlanCards
          pricing={pricing}
          selectedTier={selectedTier}
          selectedType={selectedType}
          onSelect={setSelectedTier}
        />
      </div>

      {/* Joining fee notice */}
      <div className="bg-[#FFF6ED] rounded-xl p-4 text-sm text-[#414141]">
        <div className="font-semibold mb-1">One-time joining fee: {formatPounds(joiningFee)}</div>
        <div className="text-gray-500 text-xs">Paid securely via Instant Bank Pay. Your Direct Debit mandate will be set up at the same time for your monthly subscription.</div>
      </div>

      {/* Email */}
      <div>
        <h2 className="text-lg font-semibold text-[#414141] mb-3">3. Your email address</h2>
        <div className="space-y-1">
          <Label htmlFor="email" className="text-sm text-gray-600">Email address</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={emailError ? "border-red-400" : ""}
          />
          {emailError && <p className="text-xs text-red-500">{emailError}</p>}
          <p className="text-xs text-gray-400">We'll use this to create your portal account.</p>
        </div>
      </div>

      <Button
        onClick={handleNext}
        className="w-full h-12 text-base font-semibold"
        style={{ background: "#70FFE8", color: "#414141" }}
      >
        Continue to Contract <ChevronRight size={18} className="ml-1" />
      </Button>
    </div>
  );
}

// ─── Step 2: Contract Signing ─────────────────────────────────────────────────

function ContractStep({
  sessionToken,
  onNext,
  onBack,
}: {
  sessionToken: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const sigRef = useRef<SignatureCanvas>(null);
  const [signerName, setSignerName] = useState("");
  const [signerAddress, setSignerAddress] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: template, isLoading: templateLoading } = trpc.join.getContractTemplate.useQuery();
  const signMutation = trpc.join.signContract.useMutation();

  const clearSignature = () => {
    sigRef.current?.clear();
    setHasDrawn(false);
  };

  const handleSign = async () => {
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
      await signMutation.mutateAsync({
        sessionToken,
        signatureDataUrl,
        signerName: signerName.trim(),
        signerAddress: signerAddress.trim(),
        signingUserAgent: navigator.userAgent,
        consentConfirmed: true,
        contractTextSnapshot: template?.pdfUrl
          ? `<p><strong>Contract signed via PDF document.</strong></p><p>Document: <a href="${template.pdfUrl}">${template.name ?? "JLT Group Membership Contract"}</a></p><p>The signatory confirmed they had read and agreed to the full contract before signing.</p>`
          : undefined,
      });
      onNext();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to sign contract");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-[#414141]">Sign Your Contract</h1>
          <p className="text-gray-500 text-sm">Please read the contract and sign below.</p>
        </div>
      </div>

      {/* PDF Viewer */}
      {templateLoading ? (
        <div className="flex items-center justify-center h-48 bg-gray-50 rounded-xl">
          <Loader2 className="animate-spin text-[#70FFE8]" size={28} />
        </div>
      ) : template ? (
        <div className="rounded-xl overflow-hidden border border-gray-200">
          <div className="bg-gray-50 px-4 py-2 text-xs text-gray-500 border-b border-gray-200 flex items-center justify-between">
            <span>{template.name} — scroll to read the full contract</span>
            <a
              href={template.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#02E6D2] hover:underline flex items-center gap-1"
            >
              Open full screen ↗
            </a>
          </div>
          <iframe
            src={template.pdfUrl + "#toolbar=1&navpanes=1&scrollbar=1&view=FitH"}
            className="w-full"
            style={{ height: "700px", minHeight: "600px" }}
            title="JLT Group Membership Contract"
          />
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          Contract template not available. Please contact JLT Group.
        </div>
      )}

      {/* Signature pad */}
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
          <button
            onClick={clearSignature}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
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

      <div className="bg-[#FFF6ED] rounded-xl p-4 text-xs text-gray-500">
        By signing above, you confirm you have read and agree to the JLT Group Membership Agreement. Your signature and details will be stored securely for audit purposes.
      </div>

      <Button
        onClick={handleSign}
        disabled={signMutation.isPending}
        className="w-full h-12 text-base font-semibold"
        style={{ background: "#70FFE8", color: "#414141" }}
      >
        {signMutation.isPending ? (
          <><Loader2 className="animate-spin mr-2" size={18} /> Saving...</>
        ) : (
          <>Sign & Continue to Payment <ChevronRight size={18} className="ml-1" /></>
        )}
      </Button>
    </div>
  );
}

// ─── Step 3: Payment ──────────────────────────────────────────────────────────

function PaymentStep({
  sessionToken,
  onBack,
}: {
  sessionToken: string;
  onBack: () => void;
}) {
  const [redirecting, setRedirecting] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<{ code: string; resolvedFeePence: number; savingPence: number } | null>(null);
  const [codeError, setCodeError] = useState("");
  const payMutation = trpc.join.initiatePayment.useMutation();
  const applyCodeMutation = trpc.join.applyDiscountCode.useMutation();
  const { data: session } = trpc.join.getSession.useQuery({ sessionToken });

  const handleApplyCode = async () => {
    setCodeError("");
    if (!discountInput.trim()) return;
    try {
      const result = await applyCodeMutation.mutateAsync({ sessionToken, code: discountInput.trim() });
      setAppliedCode({ code: discountInput.trim().toUpperCase(), resolvedFeePence: result.resolvedFeePence, savingPence: result.savingPence });
      toast.success("Discount code applied!");
    } catch (err: any) {
      setCodeError(err.message ?? "Invalid discount code");
    }
  };

  const handlePay = useCallback(async () => {
    if (redirecting) return;
    setRedirecting(true);
    try {
      const { authorisationUrl } = await payMutation.mutateAsync({
        sessionToken,
        origin: window.location.origin,
      });
      window.location.href = authorisationUrl;
    } catch (err: any) {
      setRedirecting(false);
      toast.error(err.message ?? "Failed to initiate payment");
    }
  }, [sessionToken, payMutation, redirecting]);

  const membershipType = session?.membershipType as "solo" | "duo" | "trio" | undefined;
  const standardFees: Record<string, number> = { solo: 69700, duo: 99700, trio: 149700 };
  const standardFee = membershipType ? (standardFees[membershipType] ?? 69700) : 69700;
  const displayFee = appliedCode ? appliedCode.resolvedFeePence : standardFee;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-[#414141]">Payment</h1>
          <p className="text-gray-500 text-sm">Complete your joining fee and set up your Direct Debit.</p>
        </div>
      </div>

      {/* Fee summary */}
      <div className="bg-[#FFF6ED] rounded-xl p-5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600 font-medium">Joining fee</span>
          <span className="text-lg font-bold text-[#414141]">{formatPounds(displayFee)}</span>
        </div>
        {appliedCode && (
          <div className="flex items-center justify-between text-emerald-600 text-sm">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={14} />
              Code <strong>{appliedCode.code}</strong> applied
            </span>
            <span>-{formatPounds(appliedCode.savingPence)} saving</span>
          </div>
        )}
        <p className="text-xs text-gray-400 pt-1">You'll also set up your monthly Direct Debit in the same secure step.</p>
      </div>

      {/* Discount code input — only show if no code applied yet */}
      {!appliedCode && (
        <div className="space-y-2">
          <Label htmlFor="discount-code" className="text-sm font-medium text-gray-700">
            Have a discount code?
          </Label>
          <div className="flex gap-2">
            <Input
              id="discount-code"
              value={discountInput}
              onChange={(e) => { setDiscountInput(e.target.value.toUpperCase()); setCodeError(""); }}
              placeholder="Enter code"
              className="flex-1 uppercase"
              onKeyDown={(e) => e.key === "Enter" && handleApplyCode()}
              disabled={applyCodeMutation.isPending}
            />
            <Button
              variant="outline"
              onClick={handleApplyCode}
              disabled={applyCodeMutation.isPending || !discountInput.trim()}
              className="shrink-0"
            >
              {applyCodeMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : "Apply"}
            </Button>
          </div>
          {codeError && <p className="text-sm text-red-500">{codeError}</p>}
        </div>
      )}

      {/* Remove applied code */}
      {appliedCode && (
        <button
          className="text-xs text-gray-400 hover:text-gray-600 underline"
          onClick={() => setAppliedCode(null)}
        >
          Remove discount code
        </button>
      )}

      <Button
        onClick={handlePay}
        disabled={payMutation.isPending || redirecting}
        className="w-full h-12 text-base font-semibold"
        style={{ background: "#70FFE8", color: "#414141" }}
      >
        {payMutation.isPending || redirecting ? (
          <><Loader2 className="animate-spin mr-2" size={18} /> Redirecting to GoCardless...</>
        ) : (
          `Pay ${formatPounds(displayFee)} & Set Up Direct Debit`
        )}
      </Button>

      <p className="text-xs text-center text-gray-400">
        Secured by GoCardless. You'll be redirected to complete payment.
      </p>
    </div>
  );
}

// ─── Step 4: Complete ─────────────────────────────────────────────────────────

function CompleteStep({ sessionToken }: { sessionToken: string }) {
  const [, navigate] = useLocation();
  const { data: session } = trpc.join.getSession.useQuery({ sessionToken });
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitesSent, setInvitesSent] = useState<string[]>([]);
  const [inviteError, setInviteError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSet, setPasswordSet] = useState(false);
  const inviteMutation = trpc.join.sendTeamInvite.useMutation();
  const setPasswordMutation = trpc.join.setPassword.useMutation();

  const isTeam = session?.membershipType === "duo" || session?.membershipType === "trio";
  const maxInvites = session?.membershipType === "duo" ? 1 : session?.membershipType === "trio" ? 2 : 0;

  const handleSetPassword = async () => {
    setPasswordError("");
    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    try {
      await setPasswordMutation.mutateAsync({ sessionToken, password });
      setPasswordSet(true);
      // Hard redirect to root — the auth router detects the session cookie
      // and redirects onboarding agents to /onboarding automatically.
      // Use replace() so back-button doesn't return to /join/complete.
      window.location.replace("/");
    } catch (err: any) {
      setPasswordError(err.message ?? "Failed to set password. Please try again.");
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
      setInviteError("Please enter a valid email address");
      return;
    }
    if (invitesSent.includes(inviteEmail)) {
      setInviteError("Already invited this email");
      return;
    }
    setInviteError("");
    try {
      await inviteMutation.mutateAsync({
        sessionToken,
        invitedEmail: inviteEmail,
        origin: window.location.origin,
      });
      setInvitesSent([...invitesSent, inviteEmail]);
      setInviteEmail("");
      toast.success(`Invitation sent to ${inviteEmail}`);
    } catch (err: any) {
      setInviteError(err.message ?? "Failed to send invite");
    }
  };

  return (
    <div className="space-y-6 text-center">
      <div className="w-20 h-20 rounded-full mx-auto flex items-center justify-center" style={{ background: "#70FFE8" }}>
        <CheckCircle2 size={40} className="text-[#414141]" />
      </div>
      <div>
        <h1 className="text-3xl font-bold text-[#414141] mb-2">Welcome to JLT Group!</h1>
        <p className="text-gray-500">
          Your joining fee has been paid and your Direct Debit is being set up. The JLT team will activate your portal access shortly.
        </p>
      </div>

      {/* Team invites */}
      {isTeam && session?.userId && (
        <Card>
          <CardContent className="pt-5 space-y-4">
            <div className="text-left">
              <h2 className="font-semibold text-[#414141] mb-1">Invite your team members</h2>
              <p className="text-sm text-gray-500">
                Send invitations to your team members ({maxInvites - invitesSent.length} remaining).
                They'll sign their own contract — no payment required.
              </p>
            </div>
            {invitesSent.map((email) => (
              <div key={email} className="flex items-center gap-2 text-sm text-[#02E6D2]">
                <CheckCircle2 size={16} /> {email}
              </div>
            ))}
            {invitesSent.length < maxInvites && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="team.member@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendInvite()}
                    className={inviteError ? "border-red-400" : ""}
                  />
                  <Button
                    onClick={handleSendInvite}
                    disabled={inviteMutation.isPending}
                    style={{ background: "#70FFE8", color: "#414141" }}
                  >
                    {inviteMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : "Send"}
                  </Button>
                </div>
                {inviteError && <p className="text-xs text-red-500 text-left">{inviteError}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Set password + complete profile */}
      <div className="rounded-xl p-5 text-white text-left space-y-4" style={{ background: "linear-gradient(135deg, #0d1a26 0%, #1a3a4a 100%)" }}>
        <div>
          <h3 className="font-semibold mb-1">Set your portal password</h3>
          <p className="text-sm text-white/70">
            Create a password to access your portal and complete your profile — bank details, emergency contact, and preferred payment date.
          </p>
        </div>
        {passwordSet ? (
          <div className="flex items-center gap-2 text-[#70FFE8] text-sm font-medium">
            <CheckCircle2 size={18} /> Password set! Redirecting to onboarding...
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-white/80 text-xs">Password</Label>
              <Input
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                onKeyDown={(e) => e.key === "Enter" && handleSetPassword()}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-white/80 text-xs">Confirm password</Label>
              <Input
                type="password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                onKeyDown={(e) => e.key === "Enter" && handleSetPassword()}
              />
            </div>
            {passwordError && (
              <p className="text-red-400 text-xs">{passwordError}</p>
            )}
            <Button
              onClick={handleSetPassword}
              disabled={setPasswordMutation.isPending || !password || !confirmPassword}
              className="w-full font-semibold"
              style={{ background: "#70FFE8", color: "#0d1a26" }}
            >
              {setPasswordMutation.isPending ? (
                <><Loader2 className="animate-spin mr-2" size={16} /> Setting password...</>
              ) : (
                "Set Password & Go to Onboarding →"
              )}
            </Button>
          </div>
        )}
      </div>

      <div className="bg-[#FFF6ED] rounded-xl p-5 text-left space-y-3">
        <h3 className="font-semibold text-[#414141]">What happens after that?</h3>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex items-start gap-2">
            <Badge className="mt-0.5 shrink-0 text-xs" style={{ background: "#70FFE8", color: "#414141" }}>1</Badge>
            <span>Complete your profile in the portal (bank details, ID documents, emergency contact, payment date).</span>
          </div>
          <div className="flex items-start gap-2">
            <Badge className="mt-0.5 shrink-0 text-xs" style={{ background: "#70FFE8", color: "#414141" }}>2</Badge>
            <span>The JLT team will review and activate your full portal access.</span>
          </div>
          <div className="flex items-start gap-2">
            <Badge className="mt-0.5 shrink-0 text-xs" style={{ background: "#70FFE8", color: "#414141" }}>3</Badge>
            <span>You'll receive your training portal login details by email — your journey begins!</span>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Questions? Email us at{" "}
        <a href="mailto:memberships@thejltgroup.co.uk" className="text-[#02E6D2] underline">
          memberships@thejltgroup.co.uk
        </a>
      </p>
    </div>
  );
}

// ─── Main JoinFlow Component ──────────────────────────────────────────────────

export default function JoinFlow() {
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const urlToken = searchParams.get("token");
  const urlStep = searchParams.get("step") as Step | null;

  const [step, setStep] = useState<Step>("plan");
  const [sessionToken, setSessionToken] = useState<string | null>(() => {
    return urlToken ?? loadSession();
  });
  const [selectedTier, setSelectedTier] = useState<MembershipTier>("business_class");
  const [selectedType, setSelectedType] = useState<MembershipType>("solo");

  const startSessionMutation = trpc.join.startSession.useMutation();

  // If we have a token from URL (returning from GC), go to complete
  useEffect(() => {
    if (urlToken) {
      setSessionToken(urlToken);
      setStep("complete");
    }
  }, [urlToken]);

  // If we have a stored session, try to recover it
  const { data: existingSession, error: sessionError } = trpc.join.getSession.useQuery(
    { sessionToken: sessionToken! },
    {
      enabled: !!sessionToken && !urlToken,
      retry: false,
    }
  );

  // Handle session fetch error (expired / not found)
  useEffect(() => {
    if (sessionError && !urlToken) {
      clearSession();
      setSessionToken(null);
      setStep("plan");
    }
  }, [sessionError, urlToken]);

  useEffect(() => {
    if (existingSession && !urlToken) {
      const s = existingSession.step as Step;
      setStep(s === "complete" ? "plan" : s); // Don't resume to complete without URL token
      if (existingSession.membershipTier) setSelectedTier(existingSession.membershipTier as MembershipTier);
      if (existingSession.membershipType) setSelectedType(existingSession.membershipType as MembershipType);
    }
  }, [existingSession, urlToken]);

  const handlePlanNext = async (tier: MembershipTier, type: MembershipType, email: string) => {
    setSelectedTier(tier);
    setSelectedType(type);
    try {
      const result = await startSessionMutation.mutateAsync({ email, membershipTier: tier, membershipType: type });
      setSessionToken(result.sessionToken);
      saveSession(result.sessionToken);
      setStep("contract");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to start session");
    }
  };

  const handleContractNext = () => {
    setStep("payment");
  };

  const handleBack = (to: Step) => {
    setStep(to);
  };

  // Progress indicator
  const steps: { key: Step; label: string }[] = [
    { key: "plan", label: "Plan" },
    { key: "contract", label: "Contract" },
    { key: "payment", label: "Payment" },
    { key: "complete", label: "Complete" },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="min-h-screen" style={{ background: "#FFF6ED" }}>
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "#70FFE8" }}>
              <span className="font-bold text-[#414141] text-xs">JLT</span>
            </div>
            <span className="font-semibold text-[#414141]">JLT Group</span>
          </div>
          <div className="text-xs text-gray-400">Secure sign-up</div>
        </div>
      </div>

      {/* Progress bar */}
      {step !== "complete" && (
        <div className="bg-white border-b border-gray-100 px-6 py-3">
          <div className="max-w-xl mx-auto">
            <div className="flex items-center gap-2">
              {steps.slice(0, 3).map((s, i) => (
                <React.Fragment key={s.key}>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                        i < stepIndex
                          ? "bg-[#02E6D2] text-white"
                          : i === stepIndex
                          ? "bg-[#70FFE8] text-[#414141]"
                          : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      {i < stepIndex ? <CheckCircle2 size={14} /> : i + 1}
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        i === stepIndex ? "text-[#414141]" : "text-gray-400"
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < 2 && (
                    <div className={`flex-1 h-0.5 ${i < stepIndex ? "bg-[#02E6D2]" : "bg-gray-200"}`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className={`mx-auto px-6 py-8 ${step === "contract" ? "max-w-3xl" : "max-w-xl"}`}>
        {startSessionMutation.isPending && step === "plan" ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-[#70FFE8]" size={32} />
          </div>
        ) : step === "plan" ? (
          <PlanStep onNext={handlePlanNext} />
        ) : step === "contract" && sessionToken ? (
          <ContractStep
            sessionToken={sessionToken}
            onNext={handleContractNext}
            onBack={() => handleBack("plan")}
          />
        ) : step === "payment" && sessionToken ? (
          <PaymentStep
            sessionToken={sessionToken}
            onBack={() => handleBack("contract")}
          />
        ) : step === "complete" && sessionToken ? (
          <CompleteStep sessionToken={sessionToken} />
        ) : (
          <div className="text-center py-20 text-gray-400">Loading...</div>
        )}
      </div>
    </div>
  );
}
