import { useState, useRef } from "react";
import { useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  CheckCircle2,
  Star,
  Users,
  Clock,
  ShieldCheck,
  Plane,
  Ship,
  Home,
  Ticket,
  Car,
  Globe,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "lucide-react";

// ─── FAQ data ────────────────────────────────────────────────────────────────
const FAQS = [
  {
    q: "Do I need experience to join?",
    a: "No experience is required at all. Our full training programme takes you from A-Z of being a travel agent, at your own pace, online.",
  },
  {
    q: "Are there any targets?",
    a: "We encourage you to set your own goals, but we will never dictate targets to you. Your business, your pace.",
  },
  {
    q: "Is this an MLM?",
    a: "Absolutely not. We are strictly a holiday-selling business. You will never be asked to recruit or build a team.",
  },
  {
    q: "Are there long-term contracts?",
    a: "No long-term lock-ins. We want you to stay because you love it, not because you're contractually obligated.",
  },
  {
    q: "Can I operate under my own brand?",
    a: "Yes! Many of our agents trade under their own brand name while being backed by JLT's ATOL protection and supplier contracts.",
  },
  {
    q: "When are commissions paid?",
    a: "Commissions are paid monthly once they have been received and reconciled from the supplier.",
  },
  {
    q: "Are you ATOL protected?",
    a: "Yes. JLT Group is fully ATOL protected, which means you can sell flight-inclusive packages and flight-only bookings legally and safely.",
  },
];

// ─── Testimonials ─────────────────────────────────────────────────────────────
const TESTIMONIALS = [
  {
    name: "Tanya",
    role: "Home working agent",
    text: "I joined JLT after wanting to get into travel for a while. I never found a company where I didn't have to commit to targets, recruitment, large upfront costs and monthly fees. By chance I stumbled upon JLT — no targets, no recruitment schemes, no crazily large upfront costs. It's the best decision I ever made!!",
  },
  {
    name: "Kenneth Down",
    role: "Independent travel agent",
    text: "Really can not fault the training! It's completely do-able in your own time. The training is so in depth with so much information — I feel fully prepared to start selling holidays.",
  },
  {
    name: "Maria Ethridge",
    role: "JLT agent",
    text: "I joined JLT a couple of months ago & I've been blown away by the training & support. The quality of the content is excellent and the team are always on hand to help.",
  },
  {
    name: "Rebecca James",
    role: "JLT agent",
    text: "After finally getting my ducks in order, I have realised I have booked over £45k in travel within the last year. I absolutely love being part of the JLT family!",
  },
];

// ─── What you can book ────────────────────────────────────────────────────────
const BOOKABLE = [
  { icon: Plane, label: "Package Holidays", desc: "Easyjet, Jet2, TUI & more" },
  { icon: Ship, label: "Cruises", desc: "P&O, Celebrity, MSC, NCL & 50+ more" },
  { icon: Plane, label: "Flights", desc: "ATOL-protected, including low-cost carriers" },
  { icon: Home, label: "Accommodation", desc: "Tens of thousands of properties globally" },
  { icon: Ticket, label: "Attractions & Tours", desc: "Disney, theme parks, events & more" },
  { icon: Car, label: "Cars & Transport", desc: "Car hire, rail, ferries & transfers" },
];

// ─── Key benefits ─────────────────────────────────────────────────────────────
const BENEFITS = [
  { icon: ShieldCheck, title: "No Targets", desc: "Set your own goals. We won't dictate them to you." },
  { icon: Clock, title: "Flexible Hours", desc: "Work around other commitments at times that suit you." },
  { icon: Users, title: "400+ Agent Community", desc: "WhatsApp groups, weekly Zoom sessions & an online hub." },
  { icon: Globe, title: "200+ Suppliers", desc: "Including TUI, Jet2, Easyjet, all major cruise lines & more." },
  { icon: Star, title: "Full Training", desc: "Self-paced online training from A-Z. Support throughout." },
  { icon: ShieldCheck, title: "No Recruiting", desc: "Strictly a holiday-selling business. Not an MLM." },
];

// ─── FAQ accordion item ───────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#e8e8e8] last:border-0">
      <button
        className="w-full flex items-center justify-between py-4 text-left text-[#414141] font-semibold text-sm hover:text-[#02E6D2] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{q}</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>
      {open && <p className="pb-4 text-sm text-[#666] leading-relaxed">{a}</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function InfoFunnelPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const refId = params.get("ref"); // referral user ID

  const formRef = useRef<HTMLDivElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    marketingConsent: false,
  });

  const submitMutation = trpc.crm.enquiryWithRef.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e) => toast.error(e.message || "Something went wrong. Please try again."),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email) {
      toast.error("Please fill in your name and email.");
      return;
    }
    submitMutation.mutate({
      ...form,
      refUserId: refId ? parseInt(refId) : undefined,
    });
  };

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#FFF6ED] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-full bg-[#70FFE8] flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="h-10 w-10 text-[#414141]" />
          </div>
          <h1 className="text-3xl font-bold text-[#414141] mb-3" style={{ fontFamily: "Poppins, sans-serif" }}>
            You're in!
          </h1>
          <p className="text-[#666] mb-6 leading-relaxed">
            Check your inbox — we've sent you the JLT Group prospectus along with everything you need to know about starting your travel business.
          </p>
          <p className="text-sm text-[#888]">
            Didn't receive it? Check your spam folder or reply to this page's link to get in touch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF6ED]" style={{ fontFamily: "Poppins, sans-serif" }}>

      {/* ── NAV ── */}
      <nav className="bg-[#414141] px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <span className="text-[#70FFE8] font-bold text-xl tracking-tight">JLT Group</span>
        </div>
        <Button
          onClick={scrollToForm}
          className="bg-[#70FFE8] text-[#414141] hover:bg-[#02E6D2] font-bold text-sm px-5 py-2 rounded-full"
        >
          Get the Info
        </Button>
      </nav>

      {/* ── HERO ── */}
      <section className="bg-[#414141] text-white px-6 py-16 md:py-24">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block bg-[#70FFE8] text-[#414141] text-xs font-bold px-4 py-1.5 rounded-full mb-6 tracking-wide uppercase">
            No experience required
          </div>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
            Turn your love of travel into{" "}
            <span className="text-[#70FFE8]">your own business</span>
          </h1>
          <p className="text-lg md:text-xl text-[#ccc] max-w-2xl mx-auto mb-10 leading-relaxed">
            The JLT Group helps passionate people start their own travel agency — with full training, 200+ supplier contracts, and a community of 400+ agents behind you.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Button
              onClick={scrollToForm}
              className="bg-[#70FFE8] text-[#414141] hover:bg-[#02E6D2] font-bold text-lg px-8 py-4 rounded-full"
            >
              Register for more info <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-6 max-w-sm mx-auto">
            <div>
              <div className="text-3xl font-bold text-[#70FFE8]">400+</div>
              <div className="text-sm text-[#aaa]">active agents</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-[#70FFE8]">200+</div>
              <div className="text-sm text-[#aaa]">suppliers</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-[#70FFE8]">40+</div>
              <div className="text-sm text-[#aaa]">hrs training</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── IS THIS FOR YOU? ── */}
      <section className="px-6 py-16 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-[#414141] text-center mb-3">Is this for you?</h2>
          <p className="text-center text-[#666] mb-10">You don't need to be a travel expert — you just need a passion for it.</p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                title: "The Group Chat Planner",
                desc: "Find yourself being the go-to person for planning holidays for friends and family? Many of our agents start because they're already doing the job — just not getting paid for it.",
              },
              {
                title: "The Career Changer",
                desc: "Looking for a new career that aligns with your passion for travel? Whether you're new to the industry or moving from another host, JLT gives you a business in a box.",
              },
              {
                title: "The Business Booker",
                desc: "Do you have a business that involves travel — a wedding planner, PA, or retreat organiser? Adding travel agent services could be a powerful new income stream.",
              },
            ].map((item) => (
              <div key={item.title} className="bg-[#FFF6ED] rounded-2xl p-6 border border-[#FFC3BC]/40">
                <div className="w-10 h-10 rounded-full bg-[#70FFE8] flex items-center justify-center mb-4">
                  <CheckCircle2 className="h-5 w-5 text-[#414141]" />
                </div>
                <h3 className="font-bold text-[#414141] mb-2">{item.title}</h3>
                <p className="text-sm text-[#666] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BENEFITS ── */}
      <section className="px-6 py-16 bg-[#FFF6ED]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-[#414141] text-center mb-3">Why JLT Group?</h2>
          <p className="text-center text-[#666] mb-10">Everything you need to build a thriving travel business.</p>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
            {BENEFITS.map((b) => (
              <div key={b.title} className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="w-10 h-10 rounded-full bg-[#70FFE8]/30 flex items-center justify-center mb-4">
                  <b.icon className="h-5 w-5 text-[#02E6D2]" />
                </div>
                <h3 className="font-bold text-[#414141] mb-1">{b.title}</h3>
                <p className="text-sm text-[#666] leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHAT CAN YOU BOOK? ── */}
      <section className="px-6 py-16 bg-[#414141] text-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-3">What can you book?</h2>
          <p className="text-center text-[#aaa] mb-10">With 200+ contracted suppliers, your options are endless.</p>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {BOOKABLE.map((item) => (
              <div key={item.label} className="bg-white/10 rounded-xl p-5 flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-[#70FFE8] flex items-center justify-center shrink-0">
                  <item.icon className="h-4 w-4 text-[#414141]" />
                </div>
                <div>
                  <div className="font-bold text-sm">{item.label}</div>
                  <div className="text-xs text-[#aaa] mt-0.5">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="px-6 py-16 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-[#414141] text-center mb-3">Our agents love us</h2>
          <p className="text-center text-[#666] mb-10">Don't just take our word for it.</p>
          <div className="grid md:grid-cols-2 gap-6">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="bg-[#FFF6ED] rounded-2xl p-6 border border-[#FFC3BC]/40">
                <div className="flex gap-1 mb-3">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-[#02E6D2] text-[#02E6D2]" />
                  ))}
                </div>
                <p className="text-sm text-[#555] leading-relaxed mb-4 italic">"{t.text}"</p>
                <div>
                  <div className="font-bold text-[#414141] text-sm">{t.name}</div>
                  <div className="text-xs text-[#888]">{t.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="px-6 py-16 bg-[#FFF6ED]">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-[#414141] text-center mb-3">You have questions</h2>
          <p className="text-center text-[#666] mb-10">We have answers.</p>
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            {FAQS.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── LEAD CAPTURE FORM ── */}
      <section ref={formRef} className="px-6 py-16 bg-[#414141]" id="get-info">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-white mb-3">Ready to find out more?</h2>
            <p className="text-[#ccc] leading-relaxed">
              Fill in your details below and we'll send you the JLT Group prospectus straight to your inbox — along with everything you need to take the next step.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 shadow-xl space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="firstName" className="text-[#414141] font-semibold text-sm">First Name *</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  placeholder="Jane"
                  required
                  className="border-[#e0e0e0] focus:border-[#02E6D2]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName" className="text-[#414141] font-semibold text-sm">Last Name *</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  placeholder="Smith"
                  required
                  className="border-[#e0e0e0] focus:border-[#02E6D2]"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[#414141] font-semibold text-sm">Email Address *</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@example.com"
                required
                className="border-[#e0e0e0] focus:border-[#02E6D2]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-[#414141] font-semibold text-sm">Phone Number <span className="text-[#999] font-normal">(optional)</span></Label>
              <Input
                id="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+44 7700 000000"
                className="border-[#e0e0e0] focus:border-[#02E6D2]"
              />
            </div>
            <div className="flex items-start gap-3 pt-1">
              <Checkbox
                id="consent"
                checked={form.marketingConsent}
                onCheckedChange={(v) => setForm((f) => ({ ...f, marketingConsent: !!v }))}
                className="mt-0.5"
              />
              <Label htmlFor="consent" className="text-xs text-[#666] leading-relaxed cursor-pointer">
                I'm happy to receive emails from JLT Group about the business opportunity and related updates. You can unsubscribe at any time.
              </Label>
            </div>
            <Button
              type="submit"
              disabled={submitMutation.isPending || !form.firstName || !form.lastName || !form.email}
              className="w-full bg-[#70FFE8] text-[#414141] hover:bg-[#02E6D2] font-bold text-base py-3 rounded-xl"
            >
              {submitMutation.isPending ? "Sending..." : "Get the Prospectus →"}
            </Button>
            <p className="text-center text-xs text-[#999]">
              No spam. No commitment. Just the info you need.
            </p>
          </form>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-[#333] text-[#aaa] text-center py-6 text-sm">
        <p>© {new Date().getFullYear()} JLT Group · <a href="mailto:support@thejltgroup.co.uk" className="hover:text-[#70FFE8]">support@thejltgroup.co.uk</a></p>
      </footer>
    </div>
  );
}
