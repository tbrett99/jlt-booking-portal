/**
 * Public application form — /apply/form?token=...
 * Uses the exact Agent Readiness Form questions.
 * Contact details are NOT collected here — they are already on the prospect record.
 */
import { useState } from "react";
import { useSearchParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

// ── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, title: "Background" },
  { id: 2, title: "Business Plans" },
  { id: 3, title: "Mindset" },
  { id: 4, title: "Readiness" },
];

// ── Checkbox group helper ─────────────────────────────────────────────────────
function CheckboxGroup({
  options,
  value,
  onChange,
  single = false,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  single?: boolean;
}) {
  function toggle(opt: string) {
    if (single) {
      onChange([opt]);
    } else {
      if (value.includes(opt)) {
        onChange(value.filter((v) => v !== opt));
      } else {
        onChange([...value, opt]);
      }
    }
  }
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={`w-full flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors text-left ${
            value.includes(opt)
              ? "border-[#02E6D2] bg-[#02E6D2]/10"
              : "border-gray-200 hover:border-[#02E6D2]/50"
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
              value.includes(opt) ? "border-[#02E6D2] bg-[#02E6D2]" : "border-gray-300"
            }`}
          >
            {value.includes(opt) && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <span className="text-sm text-[#414141]">{opt}</span>
        </button>
      ))}
    </div>
  );
}

// ── Form state type ───────────────────────────────────────────────────────────
type FormState = {
  // Section 1: Background & Experience
  whyInterested: string;
  selfEmployed: string[];
  travelExperience: string[];
  travelExperienceDetails: string;
  currentOccupation: string;
  // Section 2: Travel Business Plans
  mainGoal: string[];
  travelSpecialism: string;
  hoursPerWeek: string[];
  // Section 3: Mindset & Readiness
  homeSupport: string[];
  investmentReadiness: string[];
  selfEmployedAwareness: string[];
  biggestWorry: string;
  // Section 4: Financial & Tech Readiness + Vision + Source
  techConfidence: string[];
  financialReadiness: string[];
  twoYearVision: string;
  heardAbout: string[];
  heardAboutOther: string;
  lookingAtOthers: string[];
  lookingAtOthersDetails: string;
  consent: boolean;
};

const INITIAL_FORM: FormState = {
  whyInterested: "",
  selfEmployed: [],
  travelExperience: [],
  travelExperienceDetails: "",
  currentOccupation: "",
  mainGoal: [],
  travelSpecialism: "",
  hoursPerWeek: [],
  homeSupport: [],
  investmentReadiness: [],
  selfEmployedAwareness: [],
  biggestWorry: "",
  techConfidence: [],
  financialReadiness: [],
  twoYearVision: "",
  heardAbout: [],
  heardAboutOther: "",
  lookingAtOthers: [],
  lookingAtOthersDetails: "",
  consent: false,
};

// ── Main component ────────────────────────────────────────────────────────────
export default function ApplicationFormPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: prospect, isLoading, error } = trpc.recruitment.getApplicationByToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const submitApplication = trpc.recruitment.submitApplication.useMutation({
    onSuccess: () => { setSubmitted(true); setSubmitError(null); },
    onError: (err) => {
      const msg = err.message || "Submission failed. Please try again.";
      setSubmitError(msg);
      toast.error(msg);
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    },
  });

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function validateStep(): boolean {
    const e: Record<string, string> = {};
    if (step === 1) {
      if (!form.whyInterested.trim()) e.whyInterested = "Please tell us why you're interested";
      if (!form.selfEmployed.length) e.selfEmployed = "Please select an option";
      if (!form.travelExperience.length) e.travelExperience = "Please select an option";
      if (!form.currentOccupation.trim()) e.currentOccupation = "Please enter your current occupation";
    }
    if (step === 2) {
      if (!form.mainGoal.length) e.mainGoal = "Please select at least one option";
      if (!form.travelSpecialism.trim()) e.travelSpecialism = "Please tell us what you'd love to specialise in";
      if (!form.hoursPerWeek.length) e.hoursPerWeek = "Please select an option";
    }
    if (step === 3) {
      if (!form.homeSupport.length) e.homeSupport = "Please select an option";
      if (!form.investmentReadiness.length) e.investmentReadiness = "Please select an option";
      if (!form.selfEmployedAwareness.length) e.selfEmployedAwareness = "Please select an option";
      if (!form.biggestWorry.trim()) e.biggestWorry = "Please share your biggest worry or hesitation";
    }
    if (step === 4) {
      if (!form.techConfidence.length) e.techConfidence = "Please select an option";
      if (!form.financialReadiness.length) e.financialReadiness = "Please select an option";
      if (!form.twoYearVision.trim()) e.twoYearVision = "Please share your 2-year vision";
      if (!form.heardAbout.length) e.heardAbout = "Please tell us where you heard about us";
      if (!form.lookingAtOthers.length) e.lookingAtOthers = "Please select an option";
      if (!form.consent) e.consent = "Please confirm to submit your application";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, STEPS.length));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateStep()) return;
    submitApplication.mutate({
      token,
      // Map new form fields to the backend input
      occupation: form.currentOccupation,
      whyJlt: form.whyInterested,
      experience: form.travelExperienceDetails || undefined,
      fullOrPartTime: form.hoursPerWeek.includes("Full time") ? "full_time" : "part_time",
      anythingElse: undefined,
      // Extended fields stored as JSON
      extendedData: {
        selfEmployed: form.selfEmployed[0] ?? "",
        travelExperience: form.travelExperience[0] ?? "",
        travelExperienceDetails: form.travelExperienceDetails,
        mainGoal: form.mainGoal,
        travelSpecialism: form.travelSpecialism,
        hoursPerWeek: form.hoursPerWeek[0] ?? "",
        homeSupport: form.homeSupport[0] ?? "",
        investmentReadiness: form.investmentReadiness[0] ?? "",
        selfEmployedAwareness: form.selfEmployedAwareness[0] ?? "",
        biggestWorry: form.biggestWorry,
        techConfidence: form.techConfidence[0] ?? "",
        financialReadiness: form.financialReadiness[0] ?? "",
        twoYearVision: form.twoYearVision,
        heardAbout: form.heardAbout,
        heardAboutOther: form.heardAboutOther,
        lookingAtOthers: form.lookingAtOthers[0] ?? "",
        lookingAtOthersDetails: form.lookingAtOthersDetails,
      },
    });
  }

  // ── Guards ───────────────────────────────────────────────────────────────────
  if (!token) return <ErrorScreen title="Invalid Link" message="This application link is invalid. Please check the email we sent you and try again." />;
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFF6ED]" style={{ fontFamily: "Poppins, sans-serif" }}>
      <p className="text-[#414141]/60 text-sm">Loading your application...</p>
    </div>
  );
  if (error || !prospect) return <ErrorScreen title="Link Expired or Invalid" message="This application link is no longer valid. Please contact us at jointheteam@thejltgroup.co.uk to get a new link." />;
  if (prospect.applicationSubmittedAt && !submitted) return <SuccessScreen firstName={prospect.firstName} alreadyDone />;
  if (submitted) return <SuccessScreen firstName={prospect.firstName} />;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#FFF6ED]" style={{ fontFamily: "Poppins, sans-serif" }}>
      {/* Header */}
      <header className="bg-[#70FFE8] py-6 px-4 text-center">
        <h1 className="text-2xl font-bold text-[#414141]">JLT Group</h1>
        <p className="text-[#414141]/70 text-sm mt-1">Agent Readiness Form</p>
      </header>

      {/* Intro banner */}
      <div className="bg-white border-b border-gray-100 px-4 py-5">
        <div className="max-w-xl mx-auto">
          <p className="text-sm text-[#414141]/80 leading-relaxed">
            <strong>Thinking of joining JLT?</strong> Before we jump on a call, we'd love to know a bit about you — your background, your goals, and how serious you are about building a travel business.
          </p>
          <p className="text-xs text-[#414141]/50 mt-2 leading-relaxed">
            ⚠️ <strong>Heads up:</strong> This isn't a job. It's a self-employed opportunity where <em>you</em> build the business, and we give you the tools, training, and support to make it happen. We're here for serious entrepreneurs only.
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white border-b border-gray-100 py-4 px-4">
        <div className="max-w-xl mx-auto flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                step > s.id ? "bg-[#02E6D2] text-[#1a1a1a]" : step === s.id ? "bg-[#414141] text-white" : "bg-gray-100 text-gray-400"
              }`}>
                {step > s.id ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : s.id}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${step === s.id ? "text-[#414141]" : "text-gray-400"}`}>{s.title}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 ${step > s.id ? "bg-[#02E6D2]" : "bg-gray-100"}`} />}
            </div>
          ))}
        </div>
      </div>

      {/* Form body */}
      <div className="max-w-xl mx-auto px-4 py-10">
        <div className="bg-white rounded-2xl shadow-md p-8">
          <p className="text-sm text-[#414141]/60 mb-6">
            Hi <strong>{prospect.firstName}</strong> — step {step} of {STEPS.length}. It takes about 5 minutes.
          </p>

          <form onSubmit={step === STEPS.length ? handleSubmit : handleNext}>

            {/* ── Step 1: Background & Experience ── */}
            {step === 1 && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-[#414141]">Background &amp; Experience</h3>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    Why are you interested in becoming a travel agent? <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    value={form.whyInterested}
                    onChange={(e) => set("whyInterested", e.target.value)}
                    placeholder="Tell us what's drawn you to this opportunity..."
                    rows={4}
                    className={`resize-none ${errors.whyInterested ? "border-red-400" : ""}`}
                  />
                  {errors.whyInterested && <p className="text-red-500 text-xs mt-1">{errors.whyInterested}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    Are you currently self-employed, or have you been before? <span className="text-red-500">*</span>
                  </Label>
                  <CheckboxGroup
                    options={["Yes", "No"]}
                    value={form.selfEmployed}
                    onChange={(v) => set("selfEmployed", v)}
                    single
                  />
                  {errors.selfEmployed && <p className="text-red-500 text-xs mt-1">{errors.selfEmployed}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    Have you worked in travel or customer service before? <span className="text-red-500">*</span>
                  </Label>
                  <CheckboxGroup
                    options={["Yes", "No"]}
                    value={form.travelExperience}
                    onChange={(v) => set("travelExperience", v)}
                    single
                  />
                  {errors.travelExperience && <p className="text-red-500 text-xs mt-1">{errors.travelExperience}</p>}
                  {form.travelExperience.includes("Yes") && (
                    <div className="mt-3">
                      <Label className="text-[#414141]/70 font-normal text-sm mb-1 block">
                        If yes, please tell us a bit about it:
                      </Label>
                      <Textarea
                        value={form.travelExperienceDetails}
                        onChange={(e) => set("travelExperienceDetails", e.target.value)}
                        placeholder="e.g. 3 years as a high street travel agent, specialising in luxury holidays..."
                        rows={3}
                        className="resize-none"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    What's your current job or main source of income? <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    value={form.currentOccupation}
                    onChange={(e) => set("currentOccupation", e.target.value)}
                    placeholder="e.g. Customer Service Manager, Stay-at-home parent, Teacher..."
                    className={errors.currentOccupation ? "border-red-400" : ""}
                  />
                  {errors.currentOccupation && <p className="text-red-500 text-xs mt-1">{errors.currentOccupation}</p>}
                </div>
              </div>
            )}

            {/* ── Step 2: Your Travel Business Plans ── */}
            {step === 2 && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-[#414141]">Your Travel Business Plans</h3>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    What's your main goal for your first 12 months in business? <span className="text-red-500">*</span>
                  </Label>
                  <CheckboxGroup
                    options={[
                      "Earn some extra income",
                      "Replace my current income",
                      "Build a full-time travel business",
                      "Not sure yet",
                    ]}
                    value={form.mainGoal}
                    onChange={(v) => set("mainGoal", v)}
                  />
                  {errors.mainGoal && <p className="text-red-500 text-xs mt-1">{errors.mainGoal}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    What kind of travel would you love to specialise in? <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    value={form.travelSpecialism}
                    onChange={(e) => set("travelSpecialism", e.target.value)}
                    placeholder="e.g. luxury, family, honeymoons, cruises, adventure..."
                    className={errors.travelSpecialism ? "border-red-400" : ""}
                  />
                  {errors.travelSpecialism && <p className="text-red-500 text-xs mt-1">{errors.travelSpecialism}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    How much time do you plan to dedicate to your travel business each week? <span className="text-red-500">*</span>
                  </Label>
                  <CheckboxGroup
                    options={["Less than 5 hours", "5-10 hours", "10-20 hours", "Full time"]}
                    value={form.hoursPerWeek}
                    onChange={(v) => set("hoursPerWeek", v)}
                    single
                  />
                  {errors.hoursPerWeek && <p className="text-red-500 text-xs mt-1">{errors.hoursPerWeek}</p>}
                </div>
              </div>
            )}

            {/* ── Step 3: Mindset & Readiness ── */}
            {step === 3 && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-[#414141]">Mindset &amp; Readiness</h3>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    Do you have support at home or from those close to you to start your own business? <span className="text-red-500">*</span>
                  </Label>
                  <CheckboxGroup
                    options={["Yes", "No", "Not sure yet"]}
                    value={form.homeSupport}
                    onChange={(v) => set("homeSupport", v)}
                    single
                  />
                  {errors.homeSupport && <p className="text-red-500 text-xs mt-1">{errors.homeSupport}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    How ready are you to invest in starting your business (time, energy, and financially)? <span className="text-red-500">*</span>
                  </Label>
                  <CheckboxGroup
                    options={[
                      "100% – I'm serious and ready to go",
                      "I'm interested, but still thinking it over",
                      "Just exploring ideas right now",
                    ]}
                    value={form.investmentReadiness}
                    onChange={(v) => set("investmentReadiness", v)}
                    single
                  />
                  {errors.investmentReadiness && <p className="text-red-500 text-xs mt-1">{errors.investmentReadiness}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    Are you aware this is a self-employed role where you build the business and we support you with tools, training, and systems — but results depend on your effort? <span className="text-red-500">*</span>
                  </Label>
                  <CheckboxGroup
                    options={[
                      "Yes, I understand and that's what I'm looking for",
                      "Not really – I thought it was a job",
                    ]}
                    value={form.selfEmployedAwareness}
                    onChange={(v) => set("selfEmployedAwareness", v)}
                    single
                  />
                  {errors.selfEmployedAwareness && <p className="text-red-500 text-xs mt-1">{errors.selfEmployedAwareness}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    What's your biggest worry or hesitation about starting your own travel business? <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    value={form.biggestWorry}
                    onChange={(e) => set("biggestWorry", e.target.value)}
                    placeholder="Be honest — there are no wrong answers here..."
                    rows={4}
                    className={`resize-none ${errors.biggestWorry ? "border-red-400" : ""}`}
                  />
                  {errors.biggestWorry && <p className="text-red-500 text-xs mt-1">{errors.biggestWorry}</p>}
                </div>
              </div>
            )}

            {/* ── Step 4: Financial & Tech Readiness + Vision + Source ── */}
            {step === 4 && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-[#414141]">Financial &amp; Tech Readiness</h3>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    How confident are you using online systems and digital tools (e.g. email, social media, booking platforms)? <span className="text-red-500">*</span>
                  </Label>
                  <CheckboxGroup
                    options={[
                      "Very confident – I use tech every day",
                      "Confident – I can pick things up quickly",
                      "A bit nervous – I'll need some support",
                      "Not confident at all",
                    ]}
                    value={form.techConfidence}
                    onChange={(v) => set("techConfidence", v)}
                    single
                  />
                  {errors.techConfidence && <p className="text-red-500 text-xs mt-1">{errors.techConfidence}</p>}
                </div>

                <div>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    Are you in a position to invest in starting your travel business (initial setup fee + monthly tools)? <span className="text-red-500">*</span>
                  </Label>
                  <CheckboxGroup
                    options={[
                      "Yes – I've budgeted for it",
                      "I'll need to plan/sort finances first",
                      "Not sure what's involved yet",
                    ]}
                    value={form.financialReadiness}
                    onChange={(v) => set("financialReadiness", v)}
                    single
                  />
                  {errors.financialReadiness && <p className="text-red-500 text-xs mt-1">{errors.financialReadiness}</p>}
                </div>

                <div className="pt-2 border-t border-gray-100">
                  <h4 className="text-base font-semibold text-[#414141] mb-4">Long-Term Vision</h4>
                  <Label className="text-[#414141] font-medium mb-2 block">
                    Where would you love your travel business to be in 2 years? <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    value={form.twoYearVision}
                    onChange={(e) => set("twoYearVision", e.target.value)}
                    placeholder="Paint us a picture of your ideal travel business in 2 years..."
                    rows={4}
                    className={`resize-none ${errors.twoYearVision ? "border-red-400" : ""}`}
                  />
                  {errors.twoYearVision && <p className="text-red-500 text-xs mt-1">{errors.twoYearVision}</p>}
                </div>

                <div className="pt-2 border-t border-gray-100">
                  <h4 className="text-base font-semibold text-[#414141] mb-4">How Did You Hear About Us?</h4>

                  <div>
                    <Label className="text-[#414141] font-medium mb-2 block">
                      Where did you first come across JLT? <span className="text-red-500">*</span>
                    </Label>
                    <CheckboxGroup
                      options={["Facebook", "Instagram", "TikTok", "Recommended by someone", "Other"]}
                      value={form.heardAbout}
                      onChange={(v) => set("heardAbout", v)}
                    />
                    {errors.heardAbout && <p className="text-red-500 text-xs mt-1">{errors.heardAbout}</p>}
                    {(form.heardAbout.includes("Other") || form.heardAbout.includes("Recommended by someone")) && (
                      <div className="mt-3">
                        <Label className="text-[#414141]/70 font-normal text-sm mb-1 block">
                          If 'other', or you were referred, please provide details:
                        </Label>
                        <Input
                          value={form.heardAboutOther}
                          onChange={(e) => set("heardAboutOther", e.target.value)}
                          placeholder="e.g. referred by Jane Smith, found via Google..."
                        />
                      </div>
                    )}
                  </div>

                  <div className="mt-5">
                    <Label className="text-[#414141] font-medium mb-2 block">
                      Are you currently looking at any other host agencies or travel franchises? <span className="text-red-500">*</span>
                    </Label>
                    <CheckboxGroup
                      options={["Yes", "No"]}
                      value={form.lookingAtOthers}
                      onChange={(v) => set("lookingAtOthers", v)}
                      single
                    />
                    {errors.lookingAtOthers && <p className="text-red-500 text-xs mt-1">{errors.lookingAtOthers}</p>}
                    {form.lookingAtOthers.includes("Yes") && (
                      <div className="mt-3">
                        <Label className="text-[#414141]/70 font-normal text-sm mb-1 block">
                          If yes, which ones?
                        </Label>
                        <Input
                          value={form.lookingAtOthersDetails}
                          onChange={(e) => set("lookingAtOthersDetails", e.target.value)}
                          placeholder="e.g. Not Just Travel, Travel Counsellors..."
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Consent */}
                <div className="pt-4 border-t border-gray-100">
                  <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                    form.consent ? "border-[#02E6D2] bg-[#02E6D2]/10" : errors.consent ? "border-red-400" : "border-gray-200"
                  }`}>
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        form.consent ? "border-[#02E6D2] bg-[#02E6D2]" : "border-gray-300"
                      }`}
                      onClick={() => set("consent", !form.consent)}
                    >
                      {form.consent && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-[#414141] leading-relaxed" onClick={() => set("consent", !form.consent)}>
                      By submitting this form, I confirm I'm open to a real conversation about starting my own travel business — even if I'm just thinking about it at the moment or still in the planning stage.
                    </span>
                  </label>
                  {errors.consent && <p className="text-red-500 text-xs mt-1">{errors.consent}</p>}
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex gap-3 mt-8">
              {step > 1 && (
                <Button type="button" variant="outline" onClick={handleBack} className="flex-1 bg-white">
                  Back
                </Button>
              )}
              {step < STEPS.length ? (
                <Button type="submit" className="flex-1 bg-[#414141] hover:bg-[#414141]/90 text-white font-semibold">
                  Continue
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={submitApplication.isPending}
                  className="flex-1 bg-[#02E6D2] hover:bg-[#02E6D2]/90 text-[#1a1a1a] font-semibold"
                >
                  {submitApplication.isPending ? "Submitting..." : submitError ? "Try Again" : "Submit Application"}
                </Button>
              )}
            </div>

            {/* Submission error banner */}
            {submitError && (
              <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                <p className="font-semibold mb-1">Your application could not be submitted</p>
                <p className="mb-3">{submitError}</p>
                <p className="text-red-600/80">Please click <strong>"Try Again"</strong> above to resubmit. Your answers have been kept. If the problem continues, email us at <a href="mailto:jointheteam@thejltgroup.co.uk" className="underline font-medium">jointheteam@thejltgroup.co.uk</a> and we'll sort it for you.</p>
              </div>
            )}
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
