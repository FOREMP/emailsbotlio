import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brain, Plus, ExternalLink, Trash2, LogOut, ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const Sources = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<string>("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");

  const { data: sources = [], isLoading } = useQuery({
    queryKey: ["review-sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("review_sources")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const addSource = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("review_sources").insert({
        user_id: user!.id,
        platform: platform as "trustpilot" | "google" | "manual",
        name,
        domain: domain || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-sources"] });
      queryClient.invalidateQueries({ queryKey: ["review-sources-count"] });
      setOpen(false);
      setName("");
      setDomain("");
      setPlatform("");
      toast({ title: "Source added", description: "Review source connected successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteSource = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("review_sources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-sources"] });
      queryClient.invalidateQueries({ queryKey: ["review-sources-count"] });
      toast({ title: "Source removed" });
    },
  });

  const platformLabel = (p: string) => {
    if (p === "trustpilot") return "Trustpilot";
    if (p === "google") return "Google";
    return "Manual";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <Brain className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>ReviewBrain</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-sm text-muted-foreground truncate max-w-[200px]">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1.5" />
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">Review Sources</h1>
            <p className="text-muted-foreground text-sm mt-1">Connect platforms to aggregate your reviews.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4 mr-1.5" /> Add Source
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Review Source</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label>Platform</Label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select platform" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trustpilot">Trustpilot</SelectItem>
                      <SelectItem value="google">Google Business</SelectItem>
                      <SelectItem value="manual">Manual Import</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Display Name</Label>
                  <Input placeholder="e.g. My Store on Trustpilot" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                {platform !== "manual" && (
                  <div>
                    <Label>Domain</Label>
                    <Input placeholder="e.g. mystore.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
                    <p className="text-xs text-muted-foreground mt-1">
                      {platform === "trustpilot" ? "Your business domain on Trustpilot" : "Your Google Business listing domain"}
                    </p>
                  </div>
                )}
                <Button
                  className="w-full gradient-primary border-0 text-primary-foreground hover:opacity-90"
                  disabled={!platform || !name || addSource.isPending}
                  onClick={() => addSource.mutate()}
                >
                  {addSource.isPending ? "Adding..." : "Add Source"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading sources...</p>
        ) : sources.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
            <ExternalLink className="h-10 w-10 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="font-semibold mb-2">No sources connected</h3>
            <p className="text-muted-foreground text-sm mb-4">Add your first review source to start aggregating reviews.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sources.map((source) => (
              <div key={source.id} className="rounded-xl border border-border bg-card p-5 shadow-card">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                      {platformLabel(source.platform)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteSource.mutate(source.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <h3 className="font-semibold mb-1">{source.name}</h3>
                {source.domain && (
                  <p className="text-sm text-muted-foreground">{source.domain}</p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {source.last_synced_at
                    ? `Last synced: ${new Date(source.last_synced_at).toLocaleDateString()}`
                    : "Not synced yet"}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Sources;