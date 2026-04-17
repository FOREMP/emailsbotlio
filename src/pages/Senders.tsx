import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Mail, Globe } from "lucide-react";
import { toast } from "sonner";

interface Sender {
  id: string;
  from_email: string;
  from_name: string;
  reply_to: string | null;
  is_active: boolean;
}

const Senders = () => {
  const { user } = useAuth();
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ from_name: "", from_email: "", reply_to: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("senders").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setSenders(data || []);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user]);

  const create = async () => {
    if (!user) return;
    if (!form.from_name || !form.from_email) {
      toast.error("Name and email required");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("senders").insert({
      user_id: user.id,
      from_name: form.from_name,
      from_email: form.from_email,
      reply_to: form.reply_to || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Sender added");
    setForm({ from_name: "", from_email: "", reply_to: "" });
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("senders").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Sender removed");
    load();
  };

  const toggle = async (s: Sender) => {
    const { error } = await supabase.from("senders").update({ is_active: !s.is_active }).eq("id", s.id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 pt-28 pb-16 max-w-5xl">
        <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Senders</h1>
            <p className="text-muted-foreground">The identities your cold emails are sent from. Rotate multiple senders to keep volume natural.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-primary border-0 text-primary-foreground"><Plus className="h-4 w-4" /> Add sender</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add a sender identity</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>From name</Label>
                  <Input value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} placeholder="Eric Andersson" />
                </div>
                <div>
                  <Label>From email</Label>
                  <Input value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} placeholder="eric@yourdomain.com" />
                  <p className="text-xs text-muted-foreground mt-1">Must be on a verified sender domain.</p>
                </div>
                <div>
                  <Label>Reply-to (optional)</Label>
                  <Input value={form.reply_to} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} placeholder="eric@yourcompany.com" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={create} disabled={saving} className="gradient-primary border-0 text-primary-foreground">
                  {saving ? "Saving..." : "Add sender"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="p-6 mb-8 bg-muted/30 border-dashed">
          <div className="flex gap-4">
            <Globe className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold mb-1">Domain setup required</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Before you can actually send, verify the sender domain (e.g. <code className="text-foreground">botlio.email</code>) — a one-time DNS setup. Lovable handles SPF/DKIM/MX automatically. Until DNS verifies, sequences can be built but sending stays paused.
              </p>
            </div>
          </div>
        </Card>

        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : senders.length === 0 ? (
          <Card className="p-12 text-center">
            <Mail className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold mb-1">No senders yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Add your first sender identity above.</p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {senders.map((s) => (
              <Card key={s.id} className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="h-10 w-10 rounded-full gradient-primary flex items-center justify-center text-primary-foreground font-semibold shrink-0">
                    {s.from_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{s.from_name}</div>
                    <div className="text-sm text-muted-foreground truncate">{s.from_email}{s.reply_to && ` · reply-to ${s.reply_to}`}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant={s.is_active ? "default" : "secondary"}
                    className="cursor-pointer"
                    onClick={() => toggle(s)}
                  >
                    {s.is_active ? "Active" : "Paused"}
                  </Badge>
                  <Button variant="ghost" size="icon" onClick={() => remove(s.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Senders;
