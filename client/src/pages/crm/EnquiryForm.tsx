import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CheckCircle } from "lucide-react";

/**
 * Public embeddable enquiry form.
 * Accessible at /enquiry — no auth required.
 * Can be embedded in an iframe on the JLT website.
 */
export default function EnquiryForm() {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", marketingConsent: false });
  const [submitted, setSubmitted] = useState(false);

  const submit = trpc.crm.enquiry.submit.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (e) => toast.error(e.message),
  });

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a2a3a] to-[#0d1a26] p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#70FFE8]/20 flex items-center justify-center mx-auto">
            <CheckCircle size={32} className="text-[#70FFE8]" style={{ color: "#10b981" }} />
          </div>
          <h2 className="text-2xl font-bold">Thank you!</h2>
          <p className="text-muted-foreground">We've received your enquiry and sent you an email with more information about joining the JLT Group travel agency network.</p>
          <p className="text-sm text-muted-foreground">Please check your inbox (and spam folder) for our welcome email.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a2a3a] to-[#0d1a26] p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Join the JLT Group</h1>
          <p className="text-muted-foreground text-sm">Register your interest and we'll send you our prospectus.</p>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name *</Label>
              <Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} placeholder="Jane" />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name *</Label>
              <Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} placeholder="Smith" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email Address *</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Mobile Number</Label>
            <Input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+44 7700 000000" />
          </div>
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="consent"
              checked={form.marketingConsent}
              onCheckedChange={(v) => setForm((f) => ({ ...f, marketingConsent: !!v }))}
              className="mt-0.5"
            />
            <Label htmlFor="consent" className="text-sm font-normal text-muted-foreground cursor-pointer">
              I agree to receive marketing communications from JLT Group about travel agency opportunities. You can unsubscribe at any time.
            </Label>
          </div>
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={() => submit.mutate(form)}
          disabled={submit.isPending || !form.firstName || !form.lastName || !form.email}
        >
          {submit.isPending ? "Submitting…" : "Register My Interest"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          By submitting this form you agree to our privacy policy. We'll never share your details with third parties.
        </p>
      </div>
    </div>
  );
}
