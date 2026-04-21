import { useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowRight, Shield, Clock } from "lucide-react";

export default function MembershipSuccess() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  // If already logged in, redirect straight to onboarding
  useEffect(() => {
    if (!loading && user) {
      navigate("/onboarding");
    }
  }, [user, loading, navigate]);

  if (loading) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "linear-gradient(135deg, #0d1a26 0%, #1a2a3a 100%)" }}>
      {/* Logo */}
      <div className="mb-8">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: "#70FFE8" }}>
          <span className="text-2xl font-black text-[#0d1a26]">JLT</span>
        </div>
        <p className="text-white/60 text-sm text-center">JLT Group</p>
      </div>

      {/* Success card */}
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Green header */}
        <div className="bg-emerald-500 px-6 py-5 flex items-center gap-3">
          <CheckCircle2 size={28} className="text-white flex-shrink-0" />
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">Direct Debit Set Up!</h1>
            <p className="text-emerald-100 text-sm">Your membership is confirmed</p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-gray-700 text-sm leading-relaxed">
            Welcome to JLT Group! Your Direct Debit mandate has been set up successfully. The next step is to create your portal account and complete your onboarding profile.
          </p>

          {/* What happens next */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">What happens next</p>
            <div className="space-y-2">
              {[
                { icon: <ArrowRight size={14} className="text-[#70FFE8]" />, text: "Create your portal account below", active: true },
                { icon: <Clock size={14} className="text-gray-400" />, text: "Complete your onboarding profile (takes ~5 minutes)", active: false },
                { icon: <Shield size={14} className="text-gray-400" />, text: "Receive your training portal login shortly", active: false },
              ].map((step, i) => (
                <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-lg ${step.active ? "bg-[#f0fff9] border border-[#70FFE8]/40" : "bg-gray-50"}`}>
                  <div className="mt-0.5 flex-shrink-0">{step.icon}</div>
                  <p className={`text-sm ${step.active ? "font-medium text-gray-800" : "text-gray-500"}`}>{step.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* CTA — goes to JLT-branded register page */}
          <Link href="/register">
            <Button className="w-full h-11 font-semibold text-sm" style={{ background: "#70FFE8", color: "#0d1a26" }}>
              Create My Portal Account
              <ArrowRight size={16} className="ml-2" />
            </Button>
          </Link>

          <p className="text-center text-xs text-gray-400">
            Already have an account?{" "}
            <Link href="/" className="underline text-gray-500 hover:text-gray-700">Sign in here</Link>
          </p>
        </div>
      </div>

      <p className="mt-6 text-white/30 text-xs text-center">
        Questions? Contact us at{" "}
        <a href="mailto:memberships@thejltgroup.co.uk" className="underline text-white/50">memberships@thejltgroup.co.uk</a>
      </p>
    </div>
  );
}
