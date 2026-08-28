import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Info } from "lucide-react";


interface Domain {
  id: string;
  domain: string;
  brand: string;
  sender_subdomain: string;
  reply_to_email: string;
  is_active: boolean;
  is_verified: boolean;
  postal_address: string | null;
  tracking_host: string | null;
  tracking_host_verified_at: string | null;
  tracking_host_last_checked_at: string | null;
  tracking_host_last_error: string | null;
}

const formatCheckedAt = (value: string | null) => {
  if (!value) return "Never checked";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
};

const hasFreshCustomTracking = (domain: Domain) => {
  if (!domain.tracking_host || !domain.tracking_host_verified_at) return false;
  const verifiedAt = new Date(domain.tracking_host_verified_at).getTime();
  return Number.isFinite(verifiedAt) && verifiedAt >= Date.now() - 36 * 60 * 60 * 1000;
};

const Domains = () => {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupRunning, setSetupRunning] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupResults, setSetupResults] = useState<any[]>([]);

  const runSetup = async () => {
    setSetupRunning(true);
    setSetupError(null);
    const { data, error } = await supabase.functions.invoke("setup-tracking-proxy");
    setSetupRunning(false);
    if (error) {
      setSetupError(error.message);
      return;
    }
    if ((data as any)?.error) {
      setSetupError(String((data as any).error));
      return;
    }
    setSetupResults(((data as any)?.results ?? []) as any[]);
    loadDomains();
  };


  useEffect(() => {
    loadDomains();
  }, []);

  const loadDomains = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sending_domains")
      .select("*")
      .order("is_verified", { ascending: false })
      .order("domain", { ascending: true });
    setDomains((data ?? []) as Domain[]);
    setLoading(false);
  };

  const unverified = domains.filter((d) => !d.is_verified);
  const missingPostal = domains.filter((d) => d.is_verified && d.is_active && !d.postal_address?.trim());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Sending Domains</h1>
        <p className="text-muted-foreground mt-1">
          Only verified domains can actually send email through Lovable Emails.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All domains ({domains.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Sender subdomain</TableHead>
                    <TableHead>Reply-to</TableHead>
                    <TableHead>Postal address</TableHead>
                    <TableHead>Tracking host</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.domain}</TableCell>
                      <TableCell>{d.brand}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {d.sender_subdomain}.{d.domain}
                      </TableCell>
                      <TableCell className="text-xs">{d.reply_to_email}</TableCell>
                      <TableCell className="text-xs">
                        {d.postal_address?.trim() ? (
                          <span className="text-muted-foreground">{d.postal_address}</span>
                        ) : (
                          <Badge variant="outline" className="text-xs">Not set (GDPR)</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs min-w-[200px]">
                        {hasFreshCustomTracking(d) ? (
                          <div className="space-y-1">
                            <Badge className="gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Custom tracking healthy
                            </Badge>
                            <div className="font-mono text-xs">{d.tracking_host}</div>
                            <div className="text-muted-foreground">
                              Checked {formatCheckedAt(d.tracking_host_last_checked_at)}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Badge variant="outline">Supabase fallback active</Badge>
                            <div className="text-muted-foreground">
                              Checked {formatCheckedAt(d.tracking_host_last_checked_at)}
                            </div>
                            {d.tracking_host_last_error && (
                              <div className="max-w-[280px] text-amber-700 dark:text-amber-300">
                                {d.tracking_host_last_error}
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.is_active ? "default" : "secondary"}>
                          {d.is_active ? "Yes" : "No"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {d.is_verified ? (
                          <Badge className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Verified — can send
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="h-3 w-3" /> Not verified — cannot send
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>

                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Automatic tracking host</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sets up a Vercel proxy that serves the open-tracking pixel from{" "}
            <span className="font-mono">t.&lt;your domain&gt;</span> so the image host matches the
            From domain. A custom host is activated only after a real pixel request succeeds.
            Until then, tracking automatically uses the working Supabase endpoint.
          </p>
          <Button onClick={runSetup} disabled={setupRunning}>
            {setupRunning ? "Setting up…" : "Set up tracking host automatically"}
          </Button>
          {setupError && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Setup failed</AlertTitle>
              <AlertDescription className="text-xs">{setupError}</AlertDescription>
            </Alert>
          )}
          {setupResults.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Tracking host</TableHead>
                  <TableHead>DNS record to add</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {setupResults.map((r) => (
                  <TableRow key={r.domain}>
                    <TableCell className="font-medium">{r.domain}</TableCell>
                    <TableCell className="font-mono text-xs">{r.tracking_host}</TableCell>
                    <TableCell className="font-mono text-xs">
                      CNAME&nbsp;&nbsp;t.{r.domain}&nbsp;&nbsp;→&nbsp;&nbsp;{r.dns?.value}
                    </TableCell>
                    <TableCell>
                      {r.verified ? (
                        <Badge className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Healthy and active
                        </Badge>
                      ) : (
                        <div className="space-y-1">
                          <Badge variant="outline">Supabase fallback active</Badge>
                          {r.detail && <div className="text-xs text-muted-foreground">{r.detail}</div>}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>



      {unverified.length > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>How to verify a domain</AlertTitle>
          <AlertDescription className="space-y-2 mt-2">
            <p>
              The following {unverified.length} domain{unverified.length === 1 ? "" : "s"} cannot
              currently send email:{" "}
              <span className="font-mono">
                {unverified.map((d) => d.domain).join(", ")}
              </span>
            </p>
            <p>
              To enable a domain, add it under <strong>Cloud → Emails → Manage Domains</strong> and
              delegate its DNS to Lovable's nameservers. Once Lovable shows the domain as active, an
              admin must flip <code className="text-xs bg-muted px-1 py-0.5 rounded">is_verified = true</code> on
              the matching <code className="text-xs bg-muted px-1 py-0.5 rounded">sending_domains</code> row.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {missingPostal.length > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Add a postal address for full GDPR / CAN-SPAM compliance</AlertTitle>
          <AlertDescription className="space-y-2 mt-2">
            <p>
              {missingPostal.length} verified domain{missingPostal.length === 1 ? "" : "s"} ({" "}
              <span className="font-mono">{missingPostal.map((d) => d.domain).join(", ")}</span>
              ) {missingPostal.length === 1 ? "is" : "are"} sending without a postal address in
              the email footer. GDPR Art. 13 and CAN-SPAM both require a verifiable physical
              identifier of the sender in every commercial email.
            </p>
            <p>
              Set the address in the{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">postal_address</code> column
              on the matching <code className="text-xs bg-muted px-1 py-0.5 rounded">sending_domains</code>{" "}
              row (use the SQL editor). Emails will keep sending in the meantime.
            </p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default Domains;
