// Email-only login for the single owner account.
// Given an allow-listed email, mints a one-time token via the admin API and
// returns it so the browser can establish a session via verifyOtp — no
// password and no email roundtrip required.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_EMAILS = new Set<string>([
  "eric@foremp.se",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();

    if (!email || !ALLOWED_EMAILS.has(email)) {
      return new Response(
        JSON.stringify({ error: "This email is not authorized." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Make sure an account exists for this email; if not, create one.
    let userId: string | null = null;
    try {
      const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = list.data.users.find((u) => (u.email ?? "").toLowerCase() === email);
      userId = found?.id ?? null;
    } catch (_) {
      // ignore — we'll attempt create below
    }

    if (!userId) {
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        return new Response(
          JSON.stringify({ error: created.error?.message ?? "Could not provision account." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      userId = created.data.user.id;
    }

    // Mint a one-time magic link and return the hashed token. The browser
    // exchanges it via supabase.auth.verifyOtp({ type: 'magiclink', token_hash, email }).
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (link.error || !link.data?.properties?.hashed_token) {
      return new Response(
        JSON.stringify({ error: link.error?.message ?? "Could not create login token." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        email,
        token_hash: link.data.properties.hashed_token,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message ?? "Unexpected error." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
