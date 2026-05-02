/**
 * Public enquiry form — /apply and /apply/embed
 *
 * /apply        — full page with header/hero (standalone)
 * /apply/embed  — stripped chrome, transparent bg, for iframe embedding
 *
 * Fields: First Name, Last Name, Email (required), Phone (required)
 * Removed: tier selection, "how did you hear about us"
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// ── Shared form component ─────────────────────────────────────────────────────

function EnquiryForm({ embed = false }: { embed?: boolean }) {
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const createProspect = trpc.recruitment.createProspect.useMutation({
    onSuccess: () => {
      setSubmittedEmail(form.email);
      setSubmitted(true);
      // Notify parent window (if embedded in iframe) so it can resize
      if (embed && window.parent !== window) {
        window.parent.postMessage({ type: "jlt-enquiry-submitted" }, "*");
      }
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
    if (!form.phone.trim()) e.phone = "Phone number is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    createProspect.mutate({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone,
      tierInterest: "",
      howHeard: "",
      origin: window.location.origin,
    });
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div
        className={`flex items-center justify-center px-4 ${embed ? "py-8" : "min-h-[400px] py-16"}`}
        style={{ fontFamily: "Poppins, sans-serif" }}
      >
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg p-10 text-center">
          <div className="w-16 h-16 rounded-full bg-[#70FFE8] flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-[#414141]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-[#414141] mb-3">Check Your Inbox!</h2>
          <p className="text-[#414141]/70 text-base leading-relaxed">
            We've sent your JLT Group Prospectus to <strong>{submittedEmail}</strong>. Check your inbox (and spam folder) for an email from us with a link to view the prospectus and complete your application.
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

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div
      className={embed ? "px-4 py-6" : "max-w-xl mx-auto px-4 py-10"}
      style={{ fontFamily: "Poppins, sans-serif" }}
    >
      <div className={`bg-white rounded-2xl shadow-md p-8 ${embed ? "max-w-xl mx-auto" : ""}`}>
        {!embed && (
          <h3 className="text-xl font-semibold text-[#414141] mb-6">Tell Us About Yourself</h3>
        )}

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

          {/* Phone — required */}
          <div>
            <Label htmlFor="phone" className="text-[#414141] font-medium mb-1 block">
              Phone Number <span className="text-red-500">*</span>
            </Label>
            <Input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+44 7700 000000"
              className={errors.phone ? "border-red-400" : ""}
            />
            {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
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
  );
}

// ── Full standalone page — /apply ─────────────────────────────────────────────

export default function ApplyPage() {
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

      <EnquiryForm embed={false} />
    </div>
  );
}

// ── Embed-only page — /apply/embed ────────────────────────────────────────────
// Stripped of header/hero/nav — designed to sit inside an <iframe> on any website.
// Background is transparent so it inherits the host page's background.

export function ApplyEmbedPage() {
  return (
    <div style={{ fontFamily: "Poppins, sans-serif", background: "transparent" }}>
      <EnquiryForm embed={true} />
    </div>
  );
}
