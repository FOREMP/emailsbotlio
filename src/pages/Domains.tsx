import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Info, Save } from "lucide-react";


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
}


const Domains = () => {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

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

  const saveTrackingHost = async (id: string) => {
    const host = editing[id]?.trim() || null;
    setSaving((s) => ({ ...s, [id]: true }));
    const { error } = await supabase
      .from("sending_domains")
      .update({ tracking_host: host })
      .eq("id", id);
    setSaving((s) => ({ ...s, [id]: false }));
    if (error) {
      console.error("Failed to update tracking_host", error);
      return;
    }
    setDomains((prev) =>
      prev.map((d) => (d.id === id ? { ...d, tracking_host: host } : d))
    );
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
                        {editing[d.id] !== undefined ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editing[d.id]}
                              onChange={(e) => setEditing((prev) => ({ ...prev, [d.id]: e.target.value }))}
                              placeholder="t.foremp.email"
                              className="h-7 text-xs"
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              disabled={saving[d.id]}
                              onClick={() => saveTrackingHost(d.id)}
                            >
                              <Save className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditing((prev) => ({ ...prev, [d.id]: d.tracking_host ?? "" }))}
                            className="text-left hover:underline text-muted-foreground"
                          >
                            {d.tracking_host?.trim() ? (
                              <span className="font-mono text-foreground">{d.tracking_host}</span>
                            ) : (
                              <span>Not set (Supabase fallback)</span>
                            )}
                          </button>
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
