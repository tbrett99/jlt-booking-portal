import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Clock, XCircle, Loader2 } from "lucide-react";

export default function DdComplete() {
  const [, navigate] = useLocation();
  const [pollCount, setPollCount] = useState(0);

  const { data: ddStatus, isLoading, refetch } = trpc.gocardless.getMyDdStatus.useQuery(undefined, {
    refetchInterval: false,
  });

  // Poll every 3 seconds for up to 30 seconds to catch fast mandate activations
  useEffect(() => {
    if (pollCount >= 10) return;
    if (ddStatus?.mandate?.status === "active") return;
    const timer = setTimeout(() => {
      refetch();
      setPollCount((c) => c + 1);
    }, 3000);
    return () => clearTimeout(timer);
  }, [pollCount, ddStatus, refetch]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FFF6ED] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#02E6D2]" />
      </div>
    );
  }

  const mandateStatus = ddStatus?.mandate?.status;

  if (mandateStatus === "active") {
    const sub = ddStatus?.subscription;
    return (
      <div className="min-h-screen bg-[#FFF6ED] flex items-center justify-center p-6">
        <Card className="w-full max-w-md shadow-lg border-0">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[#70FFE8]/20 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-[#02E6D2]" />
            </div>
            <CardTitle className="text-[#414141] font-semibold text-xl">Direct Debit Set Up!</CardTitle>
            <CardDescription className="text-[#414141]/60">
              Your Direct Debit mandate is now active. Your monthly membership fee will be collected automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sub && (
              <div className="bg-[#70FFE8]/10 rounded-lg p-4 text-sm text-[#414141] space-y-1">
                <p className="font-medium">Monthly amount: £{(sub.amount / 100).toFixed(2)}</p>
                {sub.startDate && (
                  <p className="text-[#414141]/60">First payment: {sub.startDate}</p>
                )}
                {sub.dayOfMonth && (
                  <p className="text-[#414141]/60">Collected on the {sub.dayOfMonth}{["th","st","nd","rd"][Math.min(sub.dayOfMonth % 10, 3)] ?? "th"} of each month</p>
                )}
              </div>
            )}
            <Button
              onClick={() => navigate("/onboarding")}
              className="w-full bg-[#414141] hover:bg-[#414141]/90 text-white"
            >
              Continue to Onboarding
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mandateStatus === "cancelled" || mandateStatus === "failed" || mandateStatus === "expired") {
    return (
      <div className="min-h-screen bg-[#FFF6ED] flex items-center justify-center p-6">
        <Card className="w-full max-w-md shadow-lg border-0">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <CardTitle className="text-[#414141] font-semibold text-xl">Setup Not Completed</CardTitle>
            <CardDescription className="text-[#414141]/60">
              Your Direct Debit setup was not completed. Please try again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => navigate("/dd-setup")}
              className="w-full bg-[#414141] hover:bg-[#414141]/90 text-white"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pending state (most common — GoCardless webhook hasn't fired yet)
  return (
    <div className="min-h-screen bg-[#FFF6ED] flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-lg border-0">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
          <CardTitle className="text-[#414141] font-semibold text-xl">Mandate Submitted</CardTitle>
          <CardDescription className="text-[#414141]/60">
            Your Direct Debit mandate has been submitted to your bank. It typically activates within 1–2 working days.
            You will receive a confirmation email from GoCardless once it is active.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pollCount < 10 && (
            <div className="flex items-center justify-center gap-2 text-sm text-[#414141]/50">
              <Loader2 className="w-3 h-3 animate-spin" />
              Checking status…
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
