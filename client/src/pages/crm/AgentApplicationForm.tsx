import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CheckCircle, ChevronRight, ChevronLeft } from "lucide-react";

type FormData = {
  whyInterested: string;
  isSelfEmployed: string;
  hasTravelExperience: string;
  travelExperienceDetails: string;
  currentJob: string;
  businessGoal12Months: string;
  travelSpecialisation: string;
  weeklyHours: string;
  hasHomeSupport: string;
  investmentReadiness: string;
  understandsSelfEmployed: string;
  biggestHesitation: string;
  techConfidence: string;
  financialReadiness: string;
  twoYearVision: string;
  hearAboutUs: string;
  hearAboutUsDetails: string;
  lookingAtOtherAgencies: string;
  otherAgenciesDetails: string;
  confirmationAccepted: boolean;
};

const SECTIONS = [
  {
    title: "Background & Experience",
    subtitle: "Tell us about yourself and your background",
    fields: [
      { key: "whyInterested", label: "Why are you interested in becoming a travel agent with JLT Group?", type: "textarea", required: true },
      { key: "isSelfEmployed", label: "Have you ever been self-employed or run your own business?", type: "select", options: ["Yes — currently", "Yes — previously", "No, but I'm open to it", "No, and I'm not sure it's for me"] },
      { key: "hasTravelExperience", label: "Do you have any experience in travel, tourism, or customer service?", type: "select", options: ["Yes — in travel/tourism", "Yes — in customer service", "Both", "No formal experience"] },
      { key: "travelExperienceDetails", label: "If yes, please give details", type: "textarea" },
      { key: "currentJob", label: "What is your current occupation?", type: "input" },
    ],
  },
  {
    title: "Travel Business Plans",
    subtitle: "Help us understand your ambitions",
    fields: [
      { key: "businessGoal12Months", label: "What is your main goal for your travel business in the first 12 months?", type: "textarea", required: true },
      { key: "travelSpecialisation", label: "Do you have a particular area of travel you'd like to specialise in?", type: "input", placeholder: "e.g. luxury holidays, cruises, family travel, corporate travel…" },
      { key: "weeklyHours", label: "How many hours per week are you realistically able to dedicate to your travel business?", type: "select", options: ["Less than 10 hours", "10–20 hours", "20–30 hours", "30–40 hours", "Full time (40+ hours)"] },
    ],
  },
  {
    title: "Mindset & Readiness",
    subtitle: "We want to make sure this is the right fit for you",
    fields: [
      { key: "hasHomeSupport", label: "Do you have support at home to pursue this opportunity?", type: "select", options: ["Yes, fully supportive", "Somewhat — still discussing", "No, but I'm committed regardless", "Not applicable"] },
      { key: "investmentReadiness", label: "Are you prepared to invest in your business (joining fee, monthly membership, training)?", type: "select", options: ["Yes, absolutely", "Yes, with some planning", "I need more information first", "I have concerns about the cost"] },
      { key: "understandsSelfEmployed", label: "Do you understand what it means to be self-employed?", type: "select", options: ["Yes, fully", "Mostly — still learning", "Not really — I'd need guidance"] },
      { key: "biggestHesitation", label: "What is your biggest hesitation about joining?", type: "textarea" },
    ],
  },
  {
    title: "Financial & Tech Readiness",
    subtitle: "Practical considerations",
    fields: [
      { key: "techConfidence", label: "How confident are you with technology and online tools?", type: "select", options: ["Very confident", "Fairly confident", "Somewhat confident", "Not very confident — I'd need support"] },
      { key: "financialReadiness", label: "How would you describe your current financial situation?", type: "select", options: ["Stable — ready to invest", "Stable — but cautious", "Tight — but committed", "I'd need to discuss options"] },
    ],
  },
  {
    title: "Long-Term Vision",
    subtitle: "Almost done — just a few final questions",
    fields: [
      { key: "twoYearVision", label: "Where do you see your travel business in 2 years?", type: "textarea", required: true },
      { key: "hearAboutUs", label: "How did you hear about JLT Group?", type: "select", options: ["Social media (Facebook)", "Social media (Instagram)", "Social media (LinkedIn)", "Google search", "Referral from a friend/colleague", "JLT Group event", "Online advertisement", "Other"] },
      { key: "hearAboutUsDetails", label: "Please give details (if applicable)", type: "input" },
      { key: "lookingAtOtherAgencies", label: "Are you currently looking at other travel agency opportunities?", type: "select", options: ["No, JLT Group is my first choice", "Yes — comparing a few options", "Yes — I've already applied elsewhere"] },
      { key: "otherAgenciesDetails", label: "If yes, which ones?", type: "input" },
    ],
  },
];

export default function AgentApplicationForm() {
  const { prospectId } = useParams<{ prospectId: string }>();
  const [section, setSection] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<FormData>({
    whyInterested: "", isSelfEmployed: "", hasTravelExperience: "", travelExperienceDetails: "",
    currentJob: "", businessGoal12Months: "", travelSpecialisation: "", weeklyHours: "",
    hasHomeSupport: "", investmentReadiness: "", understandsSelfEmployed: "", biggestHesitation: "",
    techConfidence: "", financialReadiness: "", twoYearVision: "", hearAboutUs: "",
    hearAboutUsDetails: "", lookingAtOtherAgencies: "", otherAgenciesDetails: "",
    confirmationAccepted: false,
  });

  const submit = trpc.crm.arForm.submit.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (e) => toast.error(e.message),
  });

  const setField = (key: keyof FormData, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  const currentSection = SECTIONS[section];
  const isLast = section === SECTIONS.length - 1;
  const isFirst = section === 0;

  const renderField = (field: any) => {
    const value = form[field.key as keyof FormData] as string;
    if (field.type === "textarea") {
      return <Textarea key={field.key} rows={3} value={value} onChange={(e) => setField(field.key, e.target.value)} placeholder={field.placeholder} />;
    }
    if (field.type === "select") {
      return (
        <Select key={field.key} value={value} onValueChange={(v) => setField(field.key, v)}>
          <SelectTrigger><SelectValue placeholder="Please select…" /></SelectTrigger>
          <SelectContent>{field.options.map((o: string) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    return <Input key={field.key} value={value} onChange={(e) => setField(field.key, e.target.value)} placeholder={field.placeholder} />;
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a2a3a] to-[#0d1a26] p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold">Application Submitted!</h2>
          <p className="text-muted-foreground">Thank you for completing your Agent Application Form. Our team will review your application and be in touch shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a2a3a] to-[#0d1a26] p-4 flex items-start justify-center py-12">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full overflow-hidden">
        {/* Progress bar */}
        <div className="h-1.5 bg-gray-100">
          <div className="h-full bg-[#70FFE8] transition-all duration-300" style={{ width: `${((section + 1) / SECTIONS.length) * 100}%`, background: "#10b981" }} />
        </div>

        {/* Header */}
        <div className="px-8 pt-8 pb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Step {section + 1} of {SECTIONS.length}</span>
            <span className="text-xs font-medium text-muted-foreground">{Math.round(((section + 1) / SECTIONS.length) * 100)}% complete</span>
          </div>
          <h1 className="text-2xl font-bold">{currentSection.title}</h1>
          <p className="text-muted-foreground text-sm">{currentSection.subtitle}</p>
        </div>

        {/* Fields */}
        <div className="px-8 pb-6 space-y-5">
          {currentSection.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-sm font-medium">{field.label}{(field as any).required && <span className="text-destructive ml-0.5">*</span>}</Label>
              {renderField(field)}
            </div>
          ))}

          {/* Confirmation on last section */}
          {isLast && (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <p className="text-sm font-semibold">Declaration</p>
              <p className="text-sm text-muted-foreground">By submitting this form, I confirm that the information I have provided is accurate and complete to the best of my knowledge. I understand that this application will be reviewed by the JLT Group team.</p>
              <div className="flex items-start gap-2.5">
                <Checkbox
                  id="confirm"
                  checked={form.confirmationAccepted}
                  onCheckedChange={(v) => setField("confirmationAccepted", !!v)}
                  className="mt-0.5"
                />
                <Label htmlFor="confirm" className="text-sm font-normal cursor-pointer">I confirm the above declaration</Label>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="px-8 pb-8 flex justify-between">
          <Button variant="outline" onClick={() => setSection((s) => s - 1)} disabled={isFirst}>
            <ChevronLeft size={14} className="mr-1" />Back
          </Button>
          {isLast ? (
            <Button
              onClick={() => submit.mutate({ prospectId: parseInt(prospectId ?? "0"), ...form })}
              disabled={submit.isPending || !form.confirmationAccepted}
            >
              {submit.isPending ? "Submitting…" : "Submit Application"}
            </Button>
          ) : (
            <Button onClick={() => setSection((s) => s + 1)}>
              Next<ChevronRight size={14} className="ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
