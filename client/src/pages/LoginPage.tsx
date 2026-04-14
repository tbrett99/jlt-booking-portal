import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Forgot password modal state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.loginWithPassword.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Invalid email or password");
      setIsLoading(false);
    },
  });

  const forgotMutation = trpc.auth.forgotPassword.useMutation({
    onSuccess: () => {
      setForgotSent(true);
    },
    onError: (err) => {
      toast.error(err.message || "Something went wrong. Please try again.");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter your email and password");
      return;
    }
    setIsLoading(true);
    loginMutation.mutate({ email, password });
  };

  const handleForgotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    forgotMutation.mutate({ email: forgotEmail, origin: window.location.origin });
  };

  const handleForgotClose = () => {
    setForgotOpen(false);
    setForgotEmail("");
    setForgotSent(false);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, #414141 0%, #2a2a2a 100%)" }}
    >
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-10"
          style={{ background: "#70FFE8" }}
        />
        <div
          className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full opacity-10"
          style={{ background: "#FFC3BC" }}
        />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 font-bold text-xl"
            style={{ background: "#70FFE8", color: "#414141" }}
          >
            JLT
          </div>
          <h1 className="text-2xl font-bold text-white">JLT Group</h1>
          <p className="text-white/60 text-sm mt-1">Booking Portal</p>
        </div>

        <Card className="shadow-2xl border-0">
          <CardHeader className="pb-4">
            <h2 className="text-lg font-semibold text-center">Sign in to your account</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="text-xs font-medium hover:underline"
                    style={{ color: "#02E6D2" }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full font-semibold"
                style={{ background: "#70FFE8", color: "#414141" }}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin mr-2" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>

          </CardContent>
        </Card>

        <p className="text-center text-white/40 text-xs mt-6">
          © {new Date().getFullYear()} JLT Group. All rights reserved.
        </p>
      </div>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotOpen} onOpenChange={(open) => { if (!open) handleForgotClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset your password</DialogTitle>
            <DialogDescription>
              Enter your email address and we'll send you a link to reset your password.
            </DialogDescription>
          </DialogHeader>
          {forgotSent ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <CheckCircle2 size={48} className="text-green-500" />
              <div>
                <p className="font-semibold">Check your inbox</p>
                <p className="text-sm text-muted-foreground mt-1">
                  If an account exists for <strong>{forgotEmail}</strong>, you'll receive a
                  password reset link shortly. The link expires in 1 hour.
                </p>
              </div>
              <Button variant="outline" onClick={handleForgotClose} className="w-full">
                Back to login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email address</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={handleForgotClose}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  style={{ background: "#70FFE8", color: "#414141" }}
                  disabled={forgotMutation.isPending}
                >
                  {forgotMutation.isPending ? (
                    <><Loader2 size={14} className="animate-spin mr-2" />Sending...</>
                  ) : (
                    "Send reset link"
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
