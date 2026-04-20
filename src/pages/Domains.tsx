import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, XCircle, Info } from "lucide-react";

interface Domain {
  id: string;
  domain: string;
  brand: string;
  sender_subdomain: string;
  reply_to_email: string;
  is_active: boolean;
  is_verified: boolean;
}

const Domains = () => {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("sending_domains")
        .select("*")
        .order("is_verified", { ascending: false })
        .order("domain", { ascending: true });
      setDomains((data ?? []) as Domain[]);
      setLoading(false);
    })();
  }, []);

  const unverified = domains.filter((d) => !d.is_verified);

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
                    <TableCell>
                      <Badge variant={d.is_active ? "default" : "secondary"}>
                        {d.is_active ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {d.is_verified ? (
                        <Badge className="bg-green-600 hover:bg-green-600/90 gap-1">
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
    </div>
  );
};

export default Domains;
