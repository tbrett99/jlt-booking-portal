/**
 * Public enquiry form — /apply
 * Collects basic contact info + interest, then sends the prospectus email.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const TIER_OPTIONS = [
  { value: "associate", label: "Associate Agent" },
  { value: "established", label: "Established Agent" },
  { value: "senior", label: "Senior Agent" },
  { value: "not_sure", label: "Not sure yet" },
];

const HOW_HEARD_OPTIONS = [
  { value: "social_media", label: "Social Media" },
  { value: "google", label: "Google / Search" },
  { value: "word_of_mouth", label: "Word of Mouth" },
  { value: "existing_agent", label: "Existing JLT Agent" },
  { value: "event", label: "Event / Conference" },
  { value: "other", label: "Other" },
];

export default function ApplyPage() {
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    tierInterest: "",
    howHeard: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const createProspect = trpc.recruitment.createProspect.useMutation({
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (err) => {
      toast.error(err.message || "Something went wrong. Please try again.");
    },
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = "First name is required";
    if (!form.lastName.trim()) e.lastName = "Last name is required";
    if (!form.email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = "Please enter a valid email address";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    createProspect.mutate({
      ...form,
      origin: window.location.origin,
    });
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFF6ED] px-4">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg p-10 text-center">
          <div className="w-16 h-16 rounded-full bg-[#70FFE8] flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-[#414141]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-[#414141] mb-3" style={{ fontFamily: "Poppins, sans-serif" }}>
            Check Your Inbox!
          </h2>
          <p className="text-[#414141]/70 text-base leading-relaxed" style={{ fontFamily: "Poppins, sans-serif" }}>
            We've sent your JLT Group Prospectus to <strong>{form.email}</strong>. Please check your inbox (and spam folder) for an email from us with a link to view the prospectus and complete your application.
          </p>
          <p className="mt-4 text-sm text-[#414141]/50" style={{ fontFamily: "Poppins, sans-serif" }}>
            Questions? Email us at{" "}
            <a href="mailto:jointheteam@thejltgroup.co.uk" className="text-[#02E6D2] hover:underline">
              jointheteam@thejltgroup.co.uk
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF6ED]" style={{ fontFamily: "Poppins, sans-serif" }}>
      {/* Header */}
      <header className="bg-[#70FFE8] py-6 px-4 text-center">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold text-[#414141]">JLT Group</h1>
          <p className="text-[#414141]/70 text-sm mt-1">Travel Agency Partnership Programme</p>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-[#414141] text-white py-12 px-4 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-3">Join the JLT Group Team</h2>
          <p className="text-white/70 text-lg leading-relaxed">
            Build your travel agency career with the support, tools, and community of JLT Group. Fill in your details below and we'll send you our prospectus.
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-xl mx-auto px-4 py-10">
        <div className="bg-white rounded-2xl shadow-md p-8">
          <h3 className="text-xl font-semibold text-[#414141] mb-6">Tell Us About Yourself</h3>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName" className="text-[#414141] font-medium mb-1 block">
                  First Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  placeholder="Jane"
                  className={errors.firstName ? "border-red-400" : ""}
                />
                {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
              </div>
              <div>
                <Label htmlFor="lastName" className="text-[#414141] font-medium mb-1 block">
                  Last Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  placeholder="Smith"
                  className={errors.lastName ? "border-red-400" : ""}
                />
                {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
              </div>
            </div>

            {/* Email */}
            <div>
              <Label htmlFor="email" className="text-[#414141] font-medium mb-1 block">
                Email Address <span className="text-red-500">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="jane@example.com"
                className={errors.email ? "border-red-400" : ""}
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
            </div>

            {/* Phone */}
            <div>
              <Label htmlFor="phone" className="text-[#414141] font-medium mb-1 block">
                Phone Number <span className="text-[#414141]/40 font-normal text-xs">(optional)</span>
              </Label>
              <Input
                id="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+44 7700 000000"
              />
            </div>

            {/* Tier interest */}
            <div>
              <Label className="text-[#414141] font-medium mb-1 block">
                Which tier are you interested in? <span className="text-[#414141]/40 font-normal text-xs">(optional)</span>
              </Label>
              <Select
                value={form.tierInterest}
                onValueChange={(v) => setForm({ ...form, tierInterest: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a tier..." />
                </SelectTrigger>
                <SelectContent>
                  {TIER_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* How heard */}
            <div>
              <Label className="text-[#414141] font-medium mb-1 block">
                How did you hear about us? <span className="text-[#414141]/40 font-normal text-xs">(optional)</span>
              </Label>
              <Select
                value={form.howHeard}
                onValueChange={(v) => setForm({ ...form, howHeard: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {HOW_HEARD_OPTIONS.map((h) => (
                    <SelectItem key={h.value} value={h.value}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="submit"
              disabled={createProspect.isPending}
              className="w-full bg-[#02E6D2] hover:bg-[#02E6D2]/90 text-[#1a1a1a] font-semibold py-3 text-base"
            >
              {createProspect.isPending ? "Sending..." : "Send Me the Prospectus"}
            </Button>

            <p className="text-xs text-center text-[#414141]/50 mt-2">
              By submitting this form, you agree to be contacted by JLT Group regarding our partnership programme. We'll never share your details with third parties.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
