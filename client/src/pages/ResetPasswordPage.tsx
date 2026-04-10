import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Eye, EyeOff, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);

  const resetMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      setDone(true);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to reset password. The link may have expired.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (!token) {
      toast.error("Invalid reset link");
      return;
    }
    resetMutation.mutate({ token, newPassword });
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, #414141 0%, #2a2a2a 100%)" }}
    >
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
            <h2 className="text-lg font-semibold text-center">Set a new password</h2>
          </CardHeader>
          <CardContent>
            {!token ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <AlertCircle size={40} className="text-destructive" />
                <p className="text-sm text-muted-foreground">
                  This reset link is invalid or has expired. Please request a new one.
                </p>
                <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>
                  Back to login
                </Button>
              </div>
            ) : done ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <CheckCircle2 size={48} className="text-green-500" />
                <div>
                  <p className="font-semibold">Password updated!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your password has been changed successfully. You can now sign in with your new password.
                  </p>
                </div>
                <Button
                  className="w-full font-semibold"
                  style={{ background: "#70FFE8", color: "#414141" }}
                  onClick={() => navigate("/login")}
                >
                  Sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
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
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Repeat your new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full font-semibold"
                  style={{ background: "#70FFE8", color: "#414141" }}
                  disabled={resetMutation.isPending}
                >
                  {resetMutation.isPending ? (
                    <>
                      <Loader2 size={16} className="animate-spin mr-2" />
                      Updating...
                    </>
                  ) : (
                    "Set new password"
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-white/40 text-xs mt-6">
          © {new Date().getFullYear()} JLT Group. All rights reserved.
        </p>
      </div>
    </div>
  );
}
