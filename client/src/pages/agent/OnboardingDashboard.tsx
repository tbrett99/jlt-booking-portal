import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CheckCircle2, Upload, Clock, User,
  FileText, AlertCircle, Loader2, CreditCard,
  Heart, CalendarDays, ChevronDown, ChevronUp, Lock,
} from "lucide-react";

const PAYMENT_DAYS = [
  { value: 1 as const, label: "1st" },
  { value: 15 as const, label: "15th" },
  { value: 28 as const, label: "28th" },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type SectionKey = "personal" | "bank" | "emergency" | "documents" | "payment";

function Section({
  title, icon, complete, open, onToggle, children,
}: {
  title: string; icon: React.ReactNode; complete: boolean;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <Card className={`transition-all ${complete ? "border-emerald-500/40" : "border-border"}`}>
      <CardHeader className="pb-3 cursor-pointer select-none" onClick={onToggle}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {complete
              ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
              : <AlertCircle size={16} className="text-amber-500 shrink-0" />}
            <span className="text-sm font-semibold flex items-center gap-1.5">{icon}{title}</span>
            {complete && (
              <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-500/40 bg-emerald-500/10 ml-1">
                Complete
              </Badge>
            )}
          </div>
          {open ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

export default function OnboardingDashboard() {
  const { user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  const utils = trpc.useUtils();

  const { data: profileData, isLoading: profileLoading } = trpc.crm.agentCrm.getMyProfile.useQuery(undefined, {
    enabled: !!user,
  });
  const profile = profileData?.profile;

  const [openSection, setOpenSection] = useState<SectionKey>("personal");

  const [name, setName] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");

  const [bankAccountName, setBankAccountName] = useState("");
  const [bankSortCode, setBankSortCode] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");

  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");

  const [preferredPaymentDay, setPreferredPaymentDay] = useState<1 | 15 | 28 | null>(null);

  const [idUploading, setIdUploading] = useState(false);
  const [poaUploading, setPoaUploading] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);
  const poaRef = useRef<HTMLInputElement>(null);

  const [initialised, setInitialised] = useState(false);
  const [saving, setSaving] = useState<SectionKey | null>(null);

  useEffect(() => {
    if (!initialised && (profile !== undefined || user)) {
      setName(user?.name ?? "");
      setPersonalEmail(profile?.personalEmail ?? "");
      setMobile(profile?.mobile ?? "");
      setBusinessName((profile as any)?.businessName ?? "");
      setAddressLine1(profile?.addressLine1 ?? "");
      setAddressLine2(profile?.addressLine2 ?? "");
      setCity(profile?.city ?? "");
      setPostcode(profile?.postcode ?? "");
      setBankAccountName((profile as any)?.bankAccountName ?? "");
      setBankSortCode((profile as any)?.bankSortCode ? "••-••-••" : "");
      setBankAccountNumber((profile as any)?.bankAccountNumber ? "••••••••" : "");
      setEmergencyContactName((profile as any)?.emergencyContactName ?? "");
      setEmergencyContactPhone((profile as any)?.emergencyContactPhone ?? "");
      const d = (profile as any)?.preferredPaymentDay;
      if (d === 1 || d === 15 || d === 28) setPreferredPaymentDay(d);
      setInitialised(true);
    }
  }, [profile, user, initialised]);

  const saveProfile = trpc.crm.agentCrm.saveOnboardingProfile.useMutation({
    onSuccess: () => utils.crm.agentCrm.getMyProfile.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const uploadDoc = trpc.crm.agentCrm.uploadOnboardingDoc.useMutation({
    onSuccess: () => utils.crm.agentCrm.getMyProfile.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const personalComplete = !!(name.trim() && mobile.trim() && addressLine1.trim() && city.trim() && postcode.trim());
  const bankComplete = !!((profile as any)?.bankAccountName && (profile as any)?.bankSortCode && (profile as any)?.bankAccountNumber);
  const emergencyComplete = !!((profile as any)?.emergencyContactName && (profile as any)?.emergencyContactPhone);
  const docsComplete = !!(profile?.idDocUrl && profile?.proofOfAddressUrl);
  const paymentComplete = !!((profile as any)?.preferredPaymentDay);
  const allComplete = personalComplete && bankComplete && emergencyComplete && docsComplete && paymentComplete;

  const handleSavePersonal = async () => {
    if (!name.trim()) { toast.error("Full name is required"); return; }
    if (!mobile.trim()) { toast.error("Mobile number is required"); return; }
    if (!addressLine1.trim() || !city.trim() || !postcode.trim()) { toast.error("Full address is required"); return; }
    setSaving("personal");
    try {
      await saveProfile.mutateAsync({
        name, personalEmail: personalEmail || null, mobile: mobile || null,
        businessName: businessName || null,
        addressLine1: addressLine1 || null, addressLine2: addressLine2 || null,
        city: city || null, postcode: postcode || null, notifyOnComplete: false,
      });
      toast.success("Personal details saved");
      setOpenSection("bank");
    } finally { setSaving(null); }
  };

  const handleSaveBank = async () => {
    if (!bankAccountName.trim()) { toast.error("Account name is required"); return; }
    if (!bankSortCode.includes("\u2022") && bankSortCode.replace(/[^0-9]/g, "").length !== 6) {
      toast.error("Sort code must be 6 digits (e.g. 12-34-56)"); return;
    }
    if (!bankAccountNumber.includes("\u2022") && bankAccountNumber.replace(/[^0-9]/g, "").length !== 8) {
      toast.error("Account number must be 8 digits"); return;
    }
    setSaving("bank");
    try {
      await saveProfile.mutateAsync({
        name,
        bankAccountName: bankAccountName || null,
        bankSortCode: bankSortCode.includes("\u2022") ? null : bankSortCode.replace(/[^0-9]/g, "") || null,
        bankAccountNumber: bankAccountNumber.includes("\u2022") ? null : bankAccountNumber.replace(/[^0-9]/g, "") || null,
        notifyOnComplete: false,
      });
      toast.success("Bank details saved");
      setOpenSection("emergency");
    } finally { setSaving(null); }
  };

  const handleSaveEmergency = async () => {
    if (!emergencyContactName.trim()) { toast.error("Emergency contact name is required"); return; }
    if (!emergencyContactPhone.trim()) { toast.error("Emergency contact phone is required"); return; }
    setSaving("emergency");
    try {
      await saveProfile.mutateAsync({
        name,
        emergencyContactName: emergencyContactName || null,
        emergencyContactPhone: emergencyContactPhone || null,
        notifyOnComplete: false,
      });
      toast.success("Emergency contact saved");
      setOpenSection("documents");
    } finally { setSaving(null); }
  };

  const handleSavePaymentDay = async () => {
    if (!preferredPaymentDay) { toast.error("Please select a payment date"); return; }
    setSaving("payment");
    try {
      const isLastStep = personalComplete && bankComplete && emergencyComplete && docsComplete;
      await saveProfile.mutateAsync({
        name, preferredPaymentDay, notifyOnComplete: isLastStep,
      });
      if (isLastStep) {
        toast.success("Onboarding complete! Your subscription has been set up. The JLT team will activate your portal access shortly.");
      } else {
        toast.success("Payment date saved");
      }
      utils.crm.agentCrm.getMyProfile.invalidate();
    } finally { setSaving(null); }
  };

  const handleUploadDoc = async (file: File, docType: "id" | "proofOfAddress") => {
    if (file.size > 10 * 1024 * 1024) { toast.error("File must be under 10MB"); return; }
    if (docType === "id") setIdUploading(true); else setPoaUploading(true);
    try {
      const b64 = await fileToBase64(file);
      await uploadDoc.mutateAsync({ docType, fileBase64: b64, fileName: file.name, mimeType: file.type });
      toast.success(docType === "id" ? "ID document uploaded" : "Proof of address uploaded");
    } catch { toast.error("Upload failed. Please try again."); }
    finally {
      if (docType === "id") setIdUploading(false); else setPoaUploading(false);
    }
  };

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const completedCount = [personalComplete, bankComplete, emergencyComplete, docsComplete, paymentComplete].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-[#f5f3ef]">
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#70FFE8", color: "#0d1a26" }}>
          JLT
        </div>
        <span className="font-semibold text-sm">JLT Group</span>
        <span className="text-muted-foreground text-xs ml-auto">Secure onboarding</span>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8 space-y-4">
        <div className="rounded-xl p-5 text-white" style={{ background: "linear-gradient(135deg, #0d1a26 0%, #1a3a4a 100%)" }}>
          <h1 className="text-lg font-bold mb-1">Welcome to JLT Group!</h1>
          <p className="text-sm text-white/70 mb-3">
            Complete your profile below. Your portal access will be activated by the JLT team once everything is in order.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-white/20 rounded-full h-1.5">
              <div
                className="h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${(completedCount / 5) * 100}%`, background: "#70FFE8" }}
              />
            </div>
            <span className="text-xs text-white/70">{completedCount}/5 complete</span>
          </div>
          {allComplete && (
            <div className="mt-3 flex items-center gap-2 text-sm font-medium" style={{ color: "#70FFE8" }}>
              <CheckCircle2 size={15} />
              Profile complete — awaiting portal activation
            </div>
          )}
        </div>

        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50">
          <Clock size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Training portal access coming soon</p>
            <p className="text-xs text-amber-700 mt-0.5">You'll receive your training portal login details by email. In the meantime, please complete your profile below.</p>
          </div>
        </div>

        <Section title="Personal Details" icon={<User size={13} />} complete={personalComplete}
          open={openSection === "personal"} onToggle={() => setOpenSection(openSection === "personal" ? "bank" : "personal")}>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Full Legal Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="As it appears on your ID" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Business / Trading Name <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Smith Travel Ltd" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mobile Number *</Label>
              <Input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="+44 7700 900000" className="h-9 text-sm" type="tel" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Personal Email <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={personalEmail} onChange={e => setPersonalEmail(e.target.value)} placeholder="personal@email.com" className="h-9 text-sm" type="email" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Address Line 1 *</Label>
              <Input value={addressLine1} onChange={e => setAddressLine1(e.target.value)} placeholder="House number and street" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Address Line 2 <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={addressLine2} onChange={e => setAddressLine2(e.target.value)} placeholder="Flat, suite, etc." className="h-9 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">City *</Label>
                <Input value={city} onChange={e => setCity(e.target.value)} placeholder="City" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Postcode *</Label>
                <Input value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="Postcode" className="h-9 text-sm" />
              </div>
            </div>
            <Button onClick={handleSavePersonal} disabled={saving === "personal"} className="w-full h-9 text-sm font-semibold" style={{ background: "#70FFE8", color: "#0d1a26" }}>
              {saving === "personal" ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Save & Continue
            </Button>
          </div>
        </Section>

        <Section title="Bank Details for Commission" icon={<CreditCard size={13} />} complete={bankComplete}
          open={openSection === "bank"} onToggle={() => setOpenSection(openSection === "bank" ? "personal" : "bank")}>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Your commission payments will be sent to this account. Details are encrypted and stored securely.</p>
            <div className="space-y-1">
              <Label className="text-xs">Account Name *</Label>
              <Input value={bankAccountName} onChange={e => setBankAccountName(e.target.value)} placeholder="Name on bank account" className="h-9 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Sort Code *</Label>
                <Input
                  value={bankSortCode}
                  onChange={e => {
                    if (e.target.value.includes("\u2022")) return;
                    const d = e.target.value.replace(/[^0-9]/g, "").slice(0, 6);
                    const f = d.length >= 5 ? d.replace(/(\d{2})(\d{2})(\d{1,2})/, "$1-$2-$3")
                      : d.length >= 3 ? d.replace(/(\d{2})(\d{1,2})/, "$1-$2") : d;
                    setBankSortCode(f);
                  }}
                  onFocus={() => { if (bankSortCode === "\u2022\u2022-\u2022\u2022-\u2022\u2022") setBankSortCode(""); }}
                  placeholder="12-34-56" className="h-9 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Account Number *</Label>
                <Input
                  value={bankAccountNumber}
                  onChange={e => {
                    if (e.target.value.includes("\u2022")) return;
                    setBankAccountNumber(e.target.value.replace(/[^0-9]/g, "").slice(0, 8));
                  }}
                  onFocus={() => { if (bankAccountNumber === "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022") setBankAccountNumber(""); }}
                  placeholder="12345678" className="h-9 text-sm font-mono"
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock size={11} />
              Bank details are encrypted and never shared with third parties.
            </div>
            <Button onClick={handleSaveBank} disabled={saving === "bank"} className="w-full h-9 text-sm font-semibold" style={{ background: "#70FFE8", color: "#0d1a26" }}>
              {saving === "bank" ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Save & Continue
            </Button>
          </div>
        </Section>

        <Section title="Emergency Contact" icon={<Heart size={13} />} complete={emergencyComplete}
          open={openSection === "emergency"} onToggle={() => setOpenSection(openSection === "emergency" ? "personal" : "emergency")}>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Please provide a contact we can reach in case of an emergency.</p>
            <div className="space-y-1">
              <Label className="text-xs">Contact Name *</Label>
              <Input value={emergencyContactName} onChange={e => setEmergencyContactName(e.target.value)} placeholder="Full name" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Contact Phone Number *</Label>
              <Input value={emergencyContactPhone} onChange={e => setEmergencyContactPhone(e.target.value)} placeholder="+44 7700 900000" className="h-9 text-sm" type="tel" />
            </div>
            <Button onClick={handleSaveEmergency} disabled={saving === "emergency"} className="w-full h-9 text-sm font-semibold" style={{ background: "#70FFE8", color: "#0d1a26" }}>
              {saving === "emergency" ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Save & Continue
            </Button>
          </div>
        </Section>

        <Section title="Identity Documents" icon={<FileText size={13} />} complete={docsComplete}
          open={openSection === "documents"} onToggle={() => setOpenSection(openSection === "documents" ? "personal" : "documents")}>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">We require a copy of your photo ID and a recent proof of address for compliance. Accepted: JPG, PNG, PDF (max 10MB).</p>
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {profile?.idDocUrl ? <CheckCircle2 size={16} className="text-emerald-500" /> : <AlertCircle size={16} className="text-amber-500" />}
                  <div>
                    <p className="text-sm font-medium">Photo ID</p>
                    <p className="text-xs text-muted-foreground">Passport, driving licence, or national ID card</p>
                  </div>
                </div>
                {profile?.idDocUrl && <a href={profile.idDocUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">View</a>}
              </div>
              <input ref={idRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadDoc(f, "id"); }} />
              <Button variant="outline" size="sm" className="w-full text-xs h-8" disabled={idUploading} onClick={() => idRef.current?.click()}>
                {idUploading ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Upload size={12} className="mr-1.5" />}
                {profile?.idDocUrl ? "Replace ID Document" : "Upload ID Document"}
              </Button>
            </div>
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {profile?.proofOfAddressUrl ? <CheckCircle2 size={16} className="text-emerald-500" /> : <AlertCircle size={16} className="text-amber-500" />}
                  <div>
                    <p className="text-sm font-medium">Proof of Address</p>
                    <p className="text-xs text-muted-foreground">Bank statement or utility bill (dated within 3 months)</p>
                  </div>
                </div>
                {profile?.proofOfAddressUrl && <a href={profile.proofOfAddressUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">View</a>}
              </div>
              <input ref={poaRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadDoc(f, "proofOfAddress"); }} />
              <Button variant="outline" size="sm" className="w-full text-xs h-8" disabled={poaUploading} onClick={() => poaRef.current?.click()}>
                {poaUploading ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Upload size={12} className="mr-1.5" />}
                {profile?.proofOfAddressUrl ? "Replace Proof of Address" : "Upload Proof of Address"}
              </Button>
            </div>
            {docsComplete && (
              <Button onClick={() => setOpenSection("payment")} className="w-full h-9 text-sm font-semibold" style={{ background: "#70FFE8", color: "#0d1a26" }}>
                Continue to Payment Date
              </Button>
            )}
          </div>
        </Section>

        <Section title="Monthly Payment Date" icon={<CalendarDays size={13} />} complete={paymentComplete}
          open={openSection === "payment"} onToggle={() => setOpenSection(openSection === "payment" ? "personal" : "payment")}>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Choose the day of the month for your monthly membership subscription. Your first payment will be at least 28 days from today.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_DAYS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setPreferredPaymentDay(value)}
                  className={`rounded-lg border p-3 text-center transition-all ${
                    preferredPaymentDay === value
                      ? "border-[#70FFE8] bg-[#70FFE8]/10 font-semibold"
                      : "border-border hover:border-[#70FFE8]/50"
                  }`}
                >
                  <div className="text-xl font-bold">{label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">of month</div>
                </button>
              ))}
            </div>
            {preferredPaymentDay && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                Your first payment will be on or after the <strong>{preferredPaymentDay === 1 ? "1st" : preferredPaymentDay === 15 ? "15th" : "28th"}</strong> of the month, at least 28 days from today. Subsequent payments are taken on the same date each month.
              </p>
            )}
            <Button
              onClick={handleSavePaymentDay}
              disabled={!preferredPaymentDay || saving === "payment"}
              className="w-full h-9 text-sm font-semibold"
              style={{ background: "#70FFE8", color: "#0d1a26" }}
            >
              {saving === "payment" ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              {allComplete ? "Complete Onboarding" : "Save Payment Date"}
            </Button>
          </div>
        </Section>

        {allComplete && (
          <div className="rounded-xl p-5 border border-emerald-500/40 bg-emerald-500/10 text-center space-y-2">
            <CheckCircle2 size={32} className="text-emerald-500 mx-auto" />
            <h3 className="font-semibold text-sm">Profile Complete!</h3>
            <p className="text-xs text-muted-foreground">
              The JLT team will review your profile and activate your portal access. You will receive an email once you are ready to go.
            </p>
            <p className="text-xs text-muted-foreground">
              Questions? Email <a href="mailto:memberships@thejltgroup.co.uk" className="underline">memberships@thejltgroup.co.uk</a>
            </p>
          </div>
        )}

        <div className="text-center text-xs text-gray-400 pb-6">
          Need help? <a href="mailto:memberships@thejltgroup.co.uk" className="underline text-gray-500">memberships@thejltgroup.co.uk</a>
        </div>
      </div>
    </div>
  );
}
