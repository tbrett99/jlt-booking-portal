/**
 * Public application form — /apply/form?token=...
 * Multi-step form for prospects to complete their application.
 */
import { useState } from "react";
import { useSearchParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const STEPS = [
  { id: 1, title: "About You" },
  { id: 2, title: "Your Experience" },
  { id: 3, title: "Your Goals" },
];

export default function ApplicationFormPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    occupation: "",
    whyJlt: "",
    experience: "",
    fullOrPartTime: "" as "full_time" | "part_time" | "not_sure" | "",
    linkedinUrl: "",
    anythingElse: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load prospect info by token
  const { data: prospect, isLoading, error } = trpc.recruitment.getApplicationByToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const submitApplication = trpc.recruitment.submitApplication.useMutation({
    onSuccess: (data) => {
      if (data.alreadySubmitted) {
        setSubmitted(true);
      } else {
        setSubmitted(true);
      }
    },
    onError: (err) => {
      toast.error(err.message || "Submission failed. Please try again.");
    },
  });

  function validateStep(): boolean {
    const e: Record<string, string> = {};
    if (step === 1) {
      if (!form.occupation.trim()) e.occupation = "Please tell us your current occupation";
      if (!form.fullOrPartTime) e.fullOrPartTime = "Please select an option";
    }
    if (step === 2) {
      // experience is optional
    }
    if (step === 3) {
      if (!form.whyJlt.trim()) e.whyJlt = "Please tell us why you want to join JLT";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleNext() {
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, STEPS.length));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 1));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateStep()) return;
    submitApplication.mutate({
      token,
      occupation: form.occupation,
      whyJlt: form.whyJlt,
      experience: form.experience || undefined,
      fullOrPartTime: form.fullOrPartTime as "full_time" | "part_time" | "not_sure",
      linkedinUrl: form.linkedinUrl || undefined,
      anythingElse: form.anythingElse || undefined,
    });
  }

  // ── Invalid / missing token ──────────────────────────────────────────────────
  if (!token) {
    return (
      <ErrorScreen
        title="Invalid Link"
        message="This application link is invalid. Please check the email we sent you and try again."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFF6ED]">
        <div className="text-[#414141]/60 text-sm" style={{ fontFamily: "Poppins, sans-serif" }}>
          Loading your application...
        </div>
      </div>
    );
  }

  if (error || !prospect) {
    return (
      <ErrorScreen
        title="Link Expired or Invalid"
        message="This application link is no longer valid. Please contact us at jointheteam@thejltgroup.co.uk to get a new link."
      />
    );
  }

  // ── Already submitted ────────────────────────────────────────────────────────
  if (prospect.applicationSubmittedAt && !submitted) {
    return (
      <SuccessScreen firstName={prospect.firstName} alreadyDone />
    );
  }

  if (submitted) {
    return <SuccessScreen firstName={prospect.firstName} />;
  }

  // ── Form ─────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#FFF6ED]" style={{ fontFamily: "Poppins, sans-serif" }}>
      {/* Header */}
      <header className="bg-[#70FFE8] py-6 px-4 text-center">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold text-[#414141]">JLT Group</h1>
          <p className="text-[#414141]/70 text-sm mt-1">Application Form</p>
        </div>
      </header>

      {/* Progress */}
      <div className="bg-white border-b border-gray-100 py-4 px-4">
        <div className="max-w-xl mx-auto flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                  step > s.id
                    ? "bg-[#02E6D2] text-[#1a1a1a]"
                    : step === s.id
                    ? "bg-[#414141] text-white"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {step > s.id ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  s.id
                )}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${step === s.id ? "text-[#414141]" : "text-gray-400"}`}>
                {s.title}
              </span>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 ${step > s.id ? "bg-[#02E6D2]" : "bg-gray-100"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Form body */}
      <div className="max-w-xl mx-auto px-4 py-10">
        <div className="bg-white rounded-2xl shadow-md p-8">
          <p className="text-sm text-[#414141]/60 mb-6">
            Hi <strong>{prospect.firstName}</strong>, please complete the form below. It takes about 5 minutes.
          </p>

          <form onSubmit={step === STEPS.length ? handleSubmit : (e) => { e.preventDefault(); handleNext(); }}>
            {/* ── Step 1: About You ── */}
            {step === 1 && (
              <div className="space-y-5">
                <h3 className="text-lg font-semibold text-[#414141]">About You</h3>

                <div>
                  <Label className="text-[#414141] font-medium mb-1 block">
                    What is your current occupation? <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    value={form.occupation}
                    onChange={(e) => setForm({ ...form, occupation: e.target.value })}
                    placeholder="e.g. Travel Agent, Customer Service Manager..."
                    className={errors.occupation ? "border-red-400" : ""}
                  />
                  {errors.occupation && <p className="text-red-500 text-xs mt-1">{errors.occupation}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-1 block">
                    Are you looking to work full-time or part-time? <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={form.fullOrPartTime}
                    onValueChange={(v) => setForm({ ...form, fullOrPartTime: v as any })}
                  >
                    <SelectTrigger className={errors.fullOrPartTime ? "border-red-400" : ""}>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_time">Full-time</SelectItem>
                      <SelectItem value="part_time">Part-time</SelectItem>
                      <SelectItem value="not_sure">Not sure yet</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.fullOrPartTime && <p className="text-red-500 text-xs mt-1">{errors.fullOrPartTime}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-1 block">
                    LinkedIn Profile URL <span className="text-[#414141]/40 font-normal text-xs">(optional)</span>
                  </Label>
                  <Input
                    type="url"
                    value={form.linkedinUrl}
                    onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })}
                    placeholder="https://linkedin.com/in/yourprofile"
                  />
                </div>
              </div>
            )}

            {/* ── Step 2: Experience ── */}
            {step === 2 && (
              <div className="space-y-5">
                <h3 className="text-lg font-semibold text-[#414141]">Your Experience</h3>

                <div>
                  <Label className="text-[#414141] font-medium mb-1 block">
                    Tell us about your travel industry experience{" "}
                    <span className="text-[#414141]/40 font-normal text-xs">(optional)</span>
                  </Label>
                  <Textarea
                    value={form.experience}
                    onChange={(e) => setForm({ ...form, experience: e.target.value })}
                    placeholder="e.g. 3 years as a high street travel agent, specialising in luxury holidays..."
                    rows={5}
                    className="resize-none"
                  />
                  <p className="text-xs text-[#414141]/40 mt-1">
                    No travel experience? That's fine — tell us about any relevant sales, customer service, or hospitality background.
                  </p>
                </div>
              </div>
            )}

            {/* ── Step 3: Goals ── */}
            {step === 3 && (
              <div className="space-y-5">
                <h3 className="text-lg font-semibold text-[#414141]">Your Goals</h3>

                <div>
                  <Label className="text-[#414141] font-medium mb-1 block">
                    Why do you want to join JLT Group? <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    value={form.whyJlt}
                    onChange={(e) => setForm({ ...form, whyJlt: e.target.value })}
                    placeholder="Tell us what excites you about joining JLT Group and what you hope to achieve..."
                    rows={5}
                    className={`resize-none ${errors.whyJlt ? "border-red-400" : ""}`}
                  />
                  {errors.whyJlt && <p className="text-red-500 text-xs mt-1">{errors.whyJlt}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-1 block">
                    Anything else you'd like us to know?{" "}
                    <span className="text-[#414141]/40 font-normal text-xs">(optional)</span>
                  </Label>
                  <Textarea
                    value={form.anythingElse}
                    onChange={(e) => setForm({ ...form, anythingElse: e.target.value })}
                    placeholder="Any questions, special circumstances, or anything else you'd like to share..."
                    rows={3}
                    className="resize-none"
                  />
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex gap-3 mt-8">
              {step > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  className="flex-1"
                >
                  Back
                </Button>
              )}
              {step < STEPS.length ? (
                <Button
                  type="submit"
                  className="flex-1 bg-[#414141] hover:bg-[#414141]/90 text-white font-semibold"
                >
                  Continue
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={submitApplication.isPending}
                  className="flex-1 bg-[#02E6D2] hover:bg-[#02E6D2]/90 text-[#1a1a1a] font-semibold"
                >
                  {submitApplication.isPending ? "Submitting..." : "Submit Application"}
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SuccessScreen({ firstName, alreadyDone }: { firstName: string; alreadyDone?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFF6ED] px-4" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg p-10 text-center">
        <div className="w-16 h-16 rounded-full bg-[#70FFE8] flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-[#414141]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-[#414141] mb-3">
          {alreadyDone ? "Already Submitted!" : `Thank You, ${firstName}!`}
        </h2>
        <p className="text-[#414141]/70 text-base leading-relaxed">
          {alreadyDone
            ? "It looks like you've already submitted your application. Our team will be in touch with you shortly."
            : "Your application has been received! Our team will review it personally and be in touch within a few business days."}
        </p>
        <p className="mt-4 text-sm text-[#414141]/50">
          Questions? Email us at{" "}
          <a href="mailto:jointheteam@thejltgroup.co.uk" className="text-[#02E6D2] hover:underline">
            jointheteam@thejltgroup.co.uk
          </a>
        </p>
      </div>
    </div>
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFF6ED] px-4" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg p-10 text-center">
        <div className="w-16 h-16 rounded-full bg-[#FFC3BC] flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-[#414141]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-[#414141] mb-3">{title}</h2>
        <p className="text-[#414141]/70 text-base leading-relaxed">{message}</p>
      </div>
    </div>
  );
}
