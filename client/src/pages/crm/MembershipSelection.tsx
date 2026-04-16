import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle, Star, Zap } from "lucide-react";

type Tier = "business_class" | "first_class";
type PayDay = "1" | "15" | "28";

const TIERS = [
  {
    key: "business_class" as Tier,
    name: "Business Class",
    price: "£87",
    period: "/month",
    icon: <Zap size={24} />,
    color: "border-blue-200 bg-blue-50",
    activeColor: "border-blue-500 bg-blue-50 ring-2 ring-blue-500",
    iconColor: "text-blue-600",
    features: [
      "Access to JLT Group booking systems",
      "Commission on all bookings",
      "Agent support & training",
      "Marketing materials",
      "JLT Group branding",
    ],
  },
  {
    key: "first_class" as Tier,
    name: "First Class",
    price: "£127",
    period: "/month",
    icon: <Star size={24} />,
    color: "border-amber-200 bg-amber-50",
    activeColor: "border-amber-500 bg-amber-50 ring-2 ring-amber-500",
    iconColor: "text-amber-600",
    features: [
      "Everything in Business Class",
      "Priority support",
      "Enhanced commission rates",
      "Exclusive supplier relationships",
      "Advanced marketing support",
    ],
  },
];

const PAY_DAYS: { value: PayDay; label: string }[] = [
  { value: "1", label: "1st of the month" },
  { value: "15", label: "15th of the month" },
  { value: "28", label: "28th of the month" },
];

export default function MembershipSelection() {
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [selectedDay, setSelectedDay] = useState<PayDay | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const { data: urlData, refetch } = trpc.crm.paymentConfig.getDirectDebitUrl.useQuery(
    { tier: selectedTier ?? "business_class", paymentDay: selectedDay ?? "1" },
    { enabled: false }
  );

  const handleProceed = async () => {
    if (!selectedTier || !selectedDay) {
      toast.error("Please select a membership tier and payment date");
      return;
    }
    setRedirecting(true);
    try {
      const result = await refetch();
      if (result.data?.url) {
        window.location.href = result.data.url;
      } else {
        toast.error("Payment link not available yet. Please contact JLT Group.");
        setRedirecting(false);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Payment link not available");
      setRedirecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a2a3a] to-[#0d1a26] p-4 flex items-start justify-center py-12">
      <div className="max-w-2xl w-full space-y-6">
        {/* Header */}
        <div className="text-center text-white space-y-2">
          <h1 className="text-3xl font-bold">Choose Your Membership</h1>
          <p className="text-white/70">Select the tier and payment date that works best for you. Your monthly membership will be collected by Direct Debit.</p>
        </div>

        {/* Tier selection */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TIERS.map((tier) => {
            const isSelected = selectedTier === tier.key;
            return (
              <div
                key={tier.key}
                className={`rounded-2xl border-2 p-6 cursor-pointer transition-all ${isSelected ? tier.activeColor : tier.color + " hover:shadow-md"}`}
                onClick={() => setSelectedTier(tier.key)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${tier.iconColor} bg-white shadow-sm`}>
                    {tier.icon}
                  </div>
                  {isSelected && <CheckCircle size={20} className="text-green-600" />}
                </div>
                <h2 className="text-xl font-bold mb-1">{tier.name}</h2>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-bold">{tier.price}</span>
                  <span className="text-muted-foreground">{tier.period}</span>
                </div>
                <ul className="space-y-2">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Payment date selection */}
        <div className="bg-white rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold">Choose your monthly payment date</h3>
          <p className="text-sm text-muted-foreground">Your Direct Debit will be collected on this date each month.</p>
          <div className="grid grid-cols-3 gap-3">
            {PAY_DAYS.map(({ value, label }) => (
              <button
                key={value}
                className={`rounded-xl border-2 p-3 text-center transition-all ${selectedDay === value ? "border-primary bg-primary/5 ring-2 ring-primary" : "border-border hover:border-primary/50"}`}
                onClick={() => setSelectedDay(value)}
              >
                <div className="text-2xl font-bold">{value}{value === "1" ? "st" : value === "15" ? "th" : "th"}</div>
                <div className="text-xs text-muted-foreground mt-0.5">of the month</div>
                {selectedDay === value && <CheckCircle size={14} className="text-primary mx-auto mt-1" />}
              </button>
            ))}
          </div>
        </div>

        {/* Summary + CTA */}
        {selectedTier && selectedDay && (
          <div className="bg-white rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold">Your Selection</h3>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Membership Tier</span>
              <span className="font-medium">{TIERS.find((t) => t.key === selectedTier)?.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Monthly Amount</span>
              <span className="font-medium">{TIERS.find((t) => t.key === selectedTier)?.price}/month</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Payment Date</span>
              <span className="font-medium">{PAY_DAYS.find((d) => d.value === selectedDay)?.label}</span>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-3">You'll be redirected to set up your GoCardless Direct Debit mandate. This is a secure, FCA-authorised payment service.</p>
              <Button className="w-full" size="lg" onClick={handleProceed} disabled={redirecting}>
                {redirecting ? "Redirecting…" : "Set Up Direct Debit →"}
              </Button>
            </div>
          </div>
        )}

        <p className="text-center text-white/50 text-xs">Powered by GoCardless · Secure Direct Debit</p>
      </div>
    </div>
  );
}
