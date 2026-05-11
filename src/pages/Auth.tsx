import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { clearStoredAuthSession, useAuth } from "@/contexts/AuthContext";

const Auth = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      clearStoredAuthSession();

      const { data, error: fnError } = await supabase.functions.invoke("email-login", {
        body: { email: email.trim().toLowerCase() },
      });
      if (fnError) throw fnError;
      if (!data?.token_hash) throw new Error(data?.error ?? "Login failed.");

      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash: data.token_hash,
      });
      if (verifyError) throw verifyError;

      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      const msg =
        err?.context?.error ??
        err?.message ??
        "Couldn't sign you in. Please try again.";
      setError(typeof msg === "string" ? msg : "Login failed.");
      toast({ title: "Sign-in failed", description: typeof msg === "string" ? msg : "Login failed.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <button onClick={() => navigate("/")} className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm mb-8 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </button>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl gradient-primary mb-4">
            <Send className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Sign in
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Enter your email to access your dashboard.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Email</label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full gradient-primary border-0 text-primary-foreground hover:opacity-90">
            {loading ? "Signing in…" : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Auth;
