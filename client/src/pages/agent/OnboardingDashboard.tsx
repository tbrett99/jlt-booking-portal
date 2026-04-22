import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  CheckCircle2, Upload, Clock, BookOpen, User, Phone, Mail,
  MapPin, FileText, AlertCircle, Loader2, ChevronRight
} from "lucide-react";

const UK_REGIONS = [
  "North West", "North East", "Yorkshire & Humber", "East Midlands", "West Midlands",
  "East of England", "London", "South East", "South West", "Wales", "Scotland", "Northern Ireland",
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function OnboardingDashboard() {
  const { user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: profileData, isLoading: profileLoading } = trpc.crm.agentCrm.getMyProfile.useQuery(undefined, {
    enabled: !!user,
  });

  const profile = profileData?.profile;

  // Form state
  const [name, setName] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");
  const [initialised, setInitialised] = useState(false);

  // Doc upload state
  const [idFile, setIdFile] = useState<File | null>(null);
  const [poaFile, setPoaFile] = useState<File | null>(null);
  const [idUploading, setIdUploading] = useState(false);
  const [poaUploading, setPoaUploading] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);
  const poaRef = useRef<HTMLInputElement>(null);

  // Pre-fill from existing profile
  useEffect(() => {
    if (profile && !initialised) {
      setName(user?.name ?? "");
      setPersonalEmail(profile.personalEmail ?? "");
      setMobile(profile.mobile ?? "");
      setAddressLine1(profile.addressLine1 ?? "");
      setAddressLine2(profile.addressLine2 ?? "");
      setCity(profile.city ?? "");
      setPostcode(profile.postcode ?? "");
      setInitialised(true);
    } else if (!profile && !initialised && user) {
      setName(user.name ?? "");
      setInitialised(true);
    }
  }, [profile, user, initialised]);

  const saveProfile = trpc.crm.agentCrm.saveOnboardingProfile.useMutation({
    onSuccess: () => {
      toast.success("Profile saved!");
      utils.crm.agentCrm.getMyProfile.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const uploadDoc = trpc.crm.agentCrm.uploadOnboardingDoc.useMutation({
    onSuccess: () => {
      utils.crm.agentCrm.getMyProfile.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSaveProfile = () => {
    if (!name.trim()) { toast.error("Full name is required"); return; }
    // Check if all fields will be complete after this save
    const willHaveContact = !!(personalEmail.trim() || mobile.trim());
    const willHaveAddress = !!(addressLine1.trim() && city.trim() && postcode.trim());
    const notifyOnComplete = !!name.trim() && willHaveContact && willHaveAddress && hasIdDoc && hasPoaDoc;
    saveProfile.mutate({ name, personalEmail: personalEmail || null, mobile: mobile || null, addressLine1: addressLine1 || null, addressLine2: addressLine2 || null, city: city || null, postcode: postcode || null, notifyOnComplete });
  };

  const handleUploadDoc = async (file: File, docType: "id" | "proofOfAddress") => {
    if (docType === "id") setIdUploading(true);
    else setPoaUploading(true);
    try {
      const fileBase64 = await fileToBase64(file);
      await uploadDoc.mutateAsync({ docType, fileBase64, fileName: file.name, mimeType: file.type });
      toast.success(`${docType === "id" ? "ID document" : "Proof of address"} uploaded successfully`);
      if (docType === "id") setIdFile(null);
      else setPoaFile(null);
    } catch {
      // error handled by mutation
    } finally {
      if (docType === "id") setIdUploading(false);
      else setPoaUploading(false);
    }
  };

  // Completion check
  const hasName = !!name.trim();
  const hasContact = !!personalEmail.trim() || !!mobile.trim();
  const hasAddress = !!addressLine1.trim() && !!city.trim() && !!postcode.trim();
  const hasIdDoc = !!profile?.idDocUrl;
  const hasPoaDoc = !!profile?.proofOfAddressUrl;

  const { data: ddStatus } = trpc.gocardless.getMyDdStatus.useQuery();
  const hasDdMandate = ddStatus?.mandate?.status === "active" || ddStatus?.mandate?.status === "pending";

  const allComplete = hasName && hasContact && hasAddress && hasIdDoc && hasPoaDoc && hasDdMandate;

  const steps = [
    { label: "Full name", done: hasName },
    { label: "Contact details (email or mobile)", done: hasContact },
    { label: "Home address", done: hasAddress },
    { label: "ID document", done: hasIdDoc },
    { label: "Proof of address", done: hasPoaDoc },
    { label: "Direct Debit setup", done: hasDdMandate, action: () => navigate("/dd-setup") },
  ];
  const completedCount = steps.filter(s => s.done).length;

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-muted-foreground" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fa]">
      {/* Top bar */}
      <div className="bg-[#0d1a26] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#70FFE8" }}>
            <span className="text-xs font-black text-[#0d1a26]">JLT</span>
          </div>
          <span className="text-white font-semibold text-sm">JLT Group Portal</span>
        </div>
        <span className="text-white/50 text-xs">Onboarding</span>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        {/* Welcome header */}
        <div className="rounded-2xl p-6 text-white" style={{ background: "linear-gradient(135deg, #0d1a26 0%, #1a3a5c 100%)" }}>
          <h1 className="text-xl font-bold mb-1">Welcome to JLT Group, {user?.name?.split(" ")[0] ?? "Agent"}! 🎉</h1>
          <p className="text-white/70 text-sm">Complete your onboarding profile below. This should only take a few minutes.</p>
        </div>

        {/* Training portal notice */}
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50">
          <Clock size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Training portal login coming soon</p>
            <p className="text-xs text-amber-700 mt-0.5">You'll receive your training portal login shortly. In the meantime, please complete your onboarding profile below so we can get everything set up for you.</p>
          </div>
        </div>

        {/* Progress */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Onboarding Progress</span>
              <span className="text-muted-foreground font-normal">{completedCount}/{steps.length} complete</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full bg-gray-100 rounded-full h-2 mb-4">
              <div
                className="h-2 rounded-full transition-all duration-500"
                style={{ width: `${(completedCount / steps.length) * 100}%`, background: "#70FFE8" }}
              />
            </div>
            <div className="space-y-1.5">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {step.done
                    ? <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                    : <div className="w-[15px] h-[15px] rounded-full border-2 border-gray-300 flex-shrink-0" />
                  }
                  <span className={step.done ? "text-gray-500 line-through" : "text-gray-700"}>{step.label}</span>
                  {!step.done && (step as any).action && (
                    <button
                      onClick={(step as any).action}
                      className="ml-auto text-xs text-[#02E6D2] hover:underline font-medium flex items-center gap-0.5"
                    >
                      Set up <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {allComplete && (
              <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600" />
                <p className="text-sm font-medium text-emerald-800">Onboarding complete! The JLT team will be in touch shortly.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profile form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <User size={15} />
              Your Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Full name */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Full Name <span className="text-red-500">*</span></Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Jane Smith"
                className="h-9 text-sm"
              />
            </div>

            {/* Contact */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1"><Mail size={11} /> Personal Email</Label>
                <Input
                  type="email"
                  value={personalEmail}
                  onChange={e => setPersonalEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1"><Phone size={11} /> Mobile Number</Label>
                <Input
                  type="tel"
                  value={mobile}
                  onChange={e => setMobile(e.target.value)}
                  placeholder="07xxx xxxxxx"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            {/* Address */}
            <div className="space-y-3">
              <Label className="text-xs font-medium flex items-center gap-1"><MapPin size={11} /> Home Address</Label>
              <Input value={addressLine1} onChange={e => setAddressLine1(e.target.value)} placeholder="Address line 1" className="h-9 text-sm" />
              <Input value={addressLine2} onChange={e => setAddressLine2(e.target.value)} placeholder="Address line 2 (optional)" className="h-9 text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <Input value={city} onChange={e => setCity(e.target.value)} placeholder="City / Town" className="h-9 text-sm" />
                <Input value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="Postcode" className="h-9 text-sm" />
              </div>
            </div>

            <Button
              onClick={handleSaveProfile}
              disabled={saveProfile.isPending}
              className="w-full h-9 text-sm font-semibold"
              style={{ background: "#70FFE8", color: "#0d1a26" }}
            >
              {saveProfile.isPending ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Save Details
            </Button>
          </CardContent>
        </Card>

        {/* Document uploads */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText size={15} />
              Identity Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">We require a copy of your photo ID and a recent proof of address for compliance purposes. Accepted formats: JPG, PNG, PDF (max 10MB each).</p>

            {/* ID Document */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {profile?.idDocUrl
                    ? <CheckCircle2 size={16} className="text-emerald-500" />
                    : <AlertCircle size={16} className="text-amber-500" />
                  }
                  <div>
                    <p className="text-sm font-medium">Photo ID</p>
                    <p className="text-xs text-muted-foreground">Passport, driving licence, or national ID card</p>
                  </div>
                </div>
                {profile?.idDocUrl && (
                  <a href={profile.idDocUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">View</a>
                )}
              </div>
              <input
                ref={idRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) { setIdFile(f); handleUploadDoc(f, "id"); }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-8"
                disabled={idUploading}
                onClick={() => idRef.current?.click()}
              >
                {idUploading ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Upload size={12} className="mr-1.5" />}
                {profile?.idDocUrl ? "Replace ID Document" : "Upload ID Document"}
              </Button>
            </div>

            {/* Proof of Address */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {profile?.proofOfAddressUrl
                    ? <CheckCircle2 size={16} className="text-emerald-500" />
                    : <AlertCircle size={16} className="text-amber-500" />
                  }
                  <div>
                    <p className="text-sm font-medium">Proof of Address</p>
                    <p className="text-xs text-muted-foreground">Bank statement or utility bill (dated within 3 months)</p>
                  </div>
                </div>
                {profile?.proofOfAddressUrl && (
                  <a href={profile.proofOfAddressUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">View</a>
                )}
              </div>
              <input
                ref={poaRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) { setPoaFile(f); handleUploadDoc(f, "proofOfAddress"); }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-8"
                disabled={poaUploading}
                onClick={() => poaRef.current?.click()}
              >
                {poaUploading ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Upload size={12} className="mr-1.5" />}
                {profile?.proofOfAddressUrl ? "Replace Proof of Address" : "Upload Proof of Address"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Help */}
        <div className="text-center text-xs text-gray-400 pb-6">
          Need help? Contact us at{" "}
          <a href="mailto:memberships@thejltgroup.co.uk" className="underline text-gray-500">memberships@thejltgroup.co.uk</a>
        </div>
      </div>
    </div>
  );
}
