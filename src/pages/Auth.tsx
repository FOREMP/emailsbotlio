import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, ArrowLeft, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { clearStoredAuthSession, useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

const Auth = () => {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const SIGNUP_ACCESS_CODE = "FOREMPemail";
  const [confirmationSent, setConfirmationSent] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";

  const switchMode = (next: "signin" | "signup" | "forgot") => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  const friendlyError = (err: any): string => {
    let msg = "";
    if (typeof err === "string") msg = err;
    else if (err?.message && typeof err.message === "string") msg = err.message;
    else if (err?.error_description) msg = String(err.error_description);
    else if (err?.name) msg = String(err.name);

    msg = (msg || "").trim();
    const m = msg.toLowerCase();

    if (!msg || msg === "{}" || m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed")) {
      return "Couldn't reach the server. Check your connection and try again. (If this is the Lovable preview, try the published site.)";
    }
    if (m.includes("504") || m.includes("timeout") || m.includes("timed out") || m.includes("gateway")) {
      return "The server took too long to respond. Please try again in a moment.";
    }
    if (m.includes("invalid login") || m.includes("invalid_credentials")) return "Wrong email or password. Try again or reset your password.";
    if (m.includes("email not confirmed")) return "Please confirm your email before signing in. Check your inbox.";
    if (m.includes("rate") || m.includes("too many")) return "Too many attempts. Please wait a moment and try again.";
    if (m.includes("user not found") || m.includes("not found")) return "No account found for that email.";
    return msg;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (isForgot) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setInfo(`If an account exists for ${email}, a reset link is on its way.`);
      } else if (isSignUp) {
        if (accessCode !== SIGNUP_ACCESS_CODE) {
          throw new Error("Invalid access code. Sign-up is restricted.");
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        setConfirmationSent(true);
      } else {
        clearStoredAuthSession();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/dashboard");
      }
    } catch (err: any) {
      const msg = friendlyError(err);
      setError(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (confirmationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary">
            <Mail className="h-8 w-8 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Check your email
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              We sent a confirmation link to <strong className="text-foreground">{email}</strong>. Click it to activate your account.
            </p>
          </div>
          <Button variant="ghost" onClick={() => { setConfirmationSent(false); switchMode("signin"); }} className="text-sm">
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  const title = isForgot ? "Reset your password" : isSignUp ? "Create your account" : "Welcome back";
  const subtitle = isForgot
    ? "We'll email you a link to set a new password."
    : isSignUp
    ? "Start sending smart campaigns"
    : "Sign in to your MailxSend account";

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
            {title}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Full name</label>
              <Input placeholder="Your name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Email</label>
            <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {!isForgot && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium">Password</label>
                {!isSignUp && (
                  <button type="button" onClick={() => switchMode("forgot")} className="text-xs text-primary hover:underline">
                    Forgot password?
                  </button>
                )}
              </div>
              <Input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
          )}
          {isSignUp && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Access code</label>
              <Input type="password" placeholder="Required to create an account" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} required />
              <p className="text-xs text-muted-foreground mt-1">Sign-up is restricted. Ask the team for the access code.</p>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          {info && (
            <div className="text-sm text-foreground bg-primary/10 border border-primary/30 rounded-md px-3 py-2">
              {info}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full gradient-primary border-0 text-primary-foreground hover:opacity-90">
            {loading ? "Please wait…" : isForgot ? "Send reset link" : isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground space-y-2">
          {isForgot ? (
            <button onClick={() => switchMode("signin")} className="text-primary font-medium hover:underline">
              Back to sign in
            </button>
          ) : (
            <div>
              {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
              <button onClick={() => switchMode(isSignUp ? "signin" : "signup")} className="text-primary font-medium hover:underline">
                {isSignUp ? "Sign in" : "Sign up"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
