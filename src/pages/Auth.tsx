import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Fish, ArrowLeft, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

const Auth = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignUp) {
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
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate("/dashboard");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
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
          <Button variant="ghost" onClick={() => { setConfirmationSent(false); setIsSignUp(false); }} className="text-sm">
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center">
          <button onClick={() => navigate("/")} className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm mb-8 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </button>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl gradient-primary mb-4">
            <Fish className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isSignUp ? "Start predicting with multi-agent AI" : "Sign in to your MiroFish account"}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Full name</label>
              <Input
                placeholder="Your name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
          )}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Email</label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="w-full gradient-primary border-0 text-primary-foreground hover:opacity-90"
          >
            {loading ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-primary font-medium hover:underline"
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
