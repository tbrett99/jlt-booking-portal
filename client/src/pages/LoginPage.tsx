import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.loginWithPassword.useMutation({
    onSuccess: async () => {
      // Invalidate auth.me so the app re-reads the user (including mustChangePassword)
      // App.tsx will then route to ChangePasswordPage or the correct dashboard automatically
      await utils.auth.me.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Invalid email or password");
      setIsLoading(false);
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

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #414141 0%, #2a2a2a 100%)' }}
    >
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-10"
          style={{ background: '#70FFE8' }}
        />
        <div
          className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full opacity-10"
          style={{ background: '#FFC3BC' }}
        />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 font-bold text-xl"
            style={{ background: '#70FFE8', color: '#414141' }}
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
                <Label htmlFor="password">Password</Label>
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
                style={{ background: '#70FFE8', color: '#414141' }}
                disabled={isLoading}
              >
                {isLoading ? (
                  <><Loader2 size={16} className="animate-spin mr-2" />Signing in...</>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>

            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-center text-muted-foreground">
                Admin or Super Admin?{" "}
                <a
                  href={getLoginUrl()}
                  className="font-medium hover:underline"
                  style={{ color: '#02E6D2' }}
                >
                  Sign in with Manus
                </a>
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-white/40 text-xs mt-6">
          © {new Date().getFullYear()} JLT Group. All rights reserved.
        </p>
      </div>
    </div>
  );
}
