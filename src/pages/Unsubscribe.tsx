import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mail, CheckCircle2, XCircle, Loader2 } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type State = "loading" | "valid" | "already" | "invalid" | "submitting" | "done" | "error";

type UnsubscribeResponse = {
  valid?: boolean;
  success?: boolean;
  reason?: string;
  error?: string;
};

const Unsubscribe = () => {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const requestHeaders = useMemo(
    () => ({
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    }),
    []
  );

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: requestHeaders }
        );
        const data = (await res.json()) as UnsubscribeResponse;

        if (data.valid) setState("valid");
        else if (data.reason === "already_unsubscribed") setState("already");
        else if (data.error) {
          setErrorMsg(data.error);
          setState("error");
        } else setState("invalid");
      } catch {
        setErrorMsg("We couldn't validate this unsubscribe link.");
        setState("error");
      }
    })();
  }, [requestHeaders, token]);

  const confirm = async () => {
    if (!token) return;
    setState("submitting");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ token }),
      });
      const data = (await res.json()) as UnsubscribeResponse;

      if (data.success) setState("done");
      else if (data.reason === "already_unsubscribed") setState("already");
      else {
        setErrorMsg(data.error || "Something went wrong");
        setState("error");
      }
    } catch {
      setErrorMsg("We couldn't complete your unsubscribe right now.");
      setState("error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="h-14 w-14 rounded-full gradient-primary flex items-center justify-center mx-auto mb-5">
          <Mail className="h-7 w-7 text-primary-foreground" />
        </div>

        {state === "loading" && (
          <>
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-3">Checking your unsubscribe link…</p>
          </>
        )}

        {state === "valid" && (
          <>
            <h1 className="text-2xl font-bold mb-2">Unsubscribe from emails</h1>
            <p className="text-muted-foreground mb-6">
              You'll stop receiving emails from us. You can resubscribe at any time by contacting us.
            </p>
            <Button onClick={confirm} className="gradient-primary border-0 text-primary-foreground w-full">
              Confirm unsubscribe
            </Button>
          </>
        )}

        {state === "submitting" && (
          <>
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-3">Processing…</p>
          </>
        )}

        {state === "done" && (
          <>
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-3" />
            <h1 className="text-2xl font-bold mb-2">You're unsubscribed</h1>
            <p className="text-muted-foreground">You won't receive any more emails from us.</p>
          </>
        )}

        {state === "already" && (
          <>
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-3" />
            <h1 className="text-2xl font-bold mb-2">Already unsubscribed</h1>
            <p className="text-muted-foreground">This email is already on our suppression list.</p>
          </>
        )}

        {state === "invalid" && (
          <>
            <XCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <h1 className="text-2xl font-bold mb-2">Invalid link</h1>
            <p className="text-muted-foreground">This unsubscribe link is invalid or has expired.</p>
          </>
        )}

        {state === "error" && (
          <>
            <XCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground">{errorMsg || "Please try again later."}</p>
          </>
        )}
      </Card>
    </div>
  );
};

export default Unsubscribe;
