import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CreditCard, CalendarDays, ShieldCheck, Info } from "lucide-react";

const PAYMENT_DAYS = [1, 5, 10, 15, 20, 25, 28];

export default function DdSetup() {
  const [, navigate] = useLocation();
  const [paymentDay, setPaymentDay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: ddStatus, isLoading: statusLoading } = trpc.gocardless.getMyDdStatus.useQuery();

  const initDdSetup = trpc.gocardless.initDdSetup.useMutation({
    onSuccess: (data) => {
      // Redirect to GoCardless hosted page
      window.location.href = data.authorisationUrl;
    },
    onError: (err) => {
      setError(err.message || "Something went wrong. Please try again.");
    },
  });

  const handleSubmit = () => {
    if (!paymentDay) return;
    setError(null);
    initDdSetup.mutate({
      preferredPaymentDay: paymentDay,
      origin: window.location.origin,
    });
  };

  // Already has an active mandate
  if (!statusLoading && ddStatus?.mandate?.status === "active") {
    return (
      <div className="min-h-screen bg-[#FFF6ED] flex items-center justify-center p-6">
        <Card className="w-full max-w-md shadow-lg border-0">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[#70FFE8]/20 flex items-center justify-center">
              <ShieldCheck className="w-7 h-7 text-[#02E6D2]" />
            </div>
            <CardTitle className="text-[#414141] font-semibold text-xl">Direct Debit Active</CardTitle>
            <CardDescription className="text-[#414141]/60">
              Your Direct Debit mandate is already set up and active.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            {ddStatus.subscription && (
              <div className="bg-[#70FFE8]/10 rounded-lg p-4 text-sm text-[#414141]">
                <p className="font-medium">Monthly payment: £{(ddStatus.subscription.amount / 100).toFixed(2)}</p>
                {ddStatus.subscription.nextChargeDate && (
                  <p className="text-[#414141]/60 mt-1">Next charge: {ddStatus.subscription.nextChargeDate}</p>
                )}
              </div>
            )}
            <Button
              onClick={() => navigate("/onboarding")}
              className="w-full bg-[#414141] hover:bg-[#414141]/90 text-white"
            >
              Back to Onboarding
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pending mandate (already submitted, waiting for GoCardless)
  if (!statusLoading && ddStatus?.mandate?.status === "pending") {
    return (
      <div className="min-h-screen bg-[#FFF6ED] flex items-center justify-center p-6">
        <Card className="w-full max-w-md shadow-lg border-0">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-amber-500 animate-spin" />
            </div>
            <CardTitle className="text-[#414141] font-semibold text-xl">Mandate Pending</CardTitle>
            <CardDescription className="text-[#414141]/60">
              Your Direct Debit mandate is being processed. This usually takes 1–2 working days.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button
              onClick={() => navigate("/onboarding")}
              className="w-full bg-[#414141] hover:bg-[#414141]/90 text-white"
            >
              Back to Onboarding
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF6ED] flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[#70FFE8]/20 flex items-center justify-center">
            <CreditCard className="w-7 h-7 text-[#02E6D2]" />
          </div>
          <h1 className="text-2xl font-semibold text-[#414141]">Set Up Direct Debit</h1>
          <p className="text-[#414141]/60 mt-2 text-sm">
            Your monthly JLT membership fee will be collected by Direct Debit.
            Your first payment will start one month after your joining fee was paid.
          </p>
        </div>

        {/* Info card */}
        <Alert className="border-[#70FFE8] bg-[#70FFE8]/10">
          <Info className="h-4 w-4 text-[#02E6D2]" />
          <AlertDescription className="text-[#414141]/80 text-sm">
            You will be redirected to GoCardless — a secure, FCA-authorised payment service — to authorise your Direct Debit mandate.
            This takes approximately 2 minutes.
          </AlertDescription>
        </Alert>

        {/* Payment day selector */}
        <Card className="shadow-md border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-[#414141] flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-[#02E6D2]" />
              Choose Your Payment Day
            </CardTitle>
            <CardDescription className="text-sm text-[#414141]/60">
              Select the day of the month you would like your membership fee collected.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              onValueChange={(val) => setPaymentDay(Number(val))}
              value={paymentDay?.toString() ?? ""}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a payment day..." />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_DAYS.map((day) => (
                  <SelectItem key={day} value={day.toString()}>
                    {day === 1 ? "1st" : day === 28 ? "28th (last available)" : `${day}${["th","st","nd","rd"][Math.min(day % 10, 3)] ?? "th"}`} of each month
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!paymentDay || initDdSetup.isPending}
              className="w-full bg-[#414141] hover:bg-[#414141]/90 text-white font-medium"
            >
              {initDdSetup.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Redirecting to GoCardless…
                </>
              ) : (
                "Continue to GoCardless →"
              )}
            </Button>

            <p className="text-xs text-center text-[#414141]/40">
              Secured by GoCardless · FCA Authorised · Your bank details are never shared with JLT
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
