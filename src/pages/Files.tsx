import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, FileSpreadsheet, ArrowLeft, LogOut, Eye } from "lucide-react";
import { Link } from "react-router-dom";

type ImportedFile = {
  id: string;
  list_id: string | null;
  file_name: string;
  file_size: number | null;
  file_type: string | null;
  row_count: number;
  column_count: number;
  imported_count: number;
  columns_detected: string[];
  mapping: Record<string, string>;
  custom_columns: string[];
  sample_rows: Record<string, string>[];
  created_at: string;
};

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const Files = () => {
  const { user, signOut } = useAuth();
  const [selected, setSelected] = useState<ImportedFile | null>(null);

  const { data: files = [], isLoading } = useQuery({
    queryKey: ["imported_files"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("imported_files")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as ImportedFile[];
    },
  });

  const { data: lists = [] } = useQuery({
    queryKey: ["contact_lists"],
    queryFn: async () => {
      const { data } = await supabase.from("contact_lists").select("id, name");
      return data ?? [];
    },
  });

  const listName = (id: string | null) => lists.find((l) => l.id === id)?.name ?? "—";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <Send className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>MailxSend</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-sm text-muted-foreground truncate max-w-[200px]">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4 mr-1.5" />Log out</Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6">
          <Link to="/dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Dashboard</Button>
          </Link>
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Uploaded Files</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Every CSV/Excel file you've imported. We extract the data and store it in your contacts — the original file isn't kept.
          </p>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : files.length === 0 ? (
          <div className="rounded-xl border border-border bg-card shadow-card p-12 text-center">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm mb-4">No files uploaded yet.</p>
            <Link to="/contacts"><Button size="sm" className="gradient-primary border-0 text-primary-foreground hover:opacity-90">Go to Contacts to import</Button></Link>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">File</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">List</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Rows</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Columns</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Size</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Imported</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">View</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate max-w-[280px]" title={f.file_name}>{f.file_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{listName(f.list_id)}</td>
                      <td className="px-4 py-3">{f.imported_count}</td>
                      <td className="px-4 py-3 text-muted-foreground">{f.column_count}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatBytes(f.file_size)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(f.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(f)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" /> {selected?.file_name}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">List</div><div className="font-medium">{listName(selected.list_id)}</div></div>
                <div><div className="text-xs text-muted-foreground">Rows imported</div><div className="font-medium">{selected.imported_count}</div></div>
                <div><div className="text-xs text-muted-foreground">Columns</div><div className="font-medium">{selected.column_count}</div></div>
                <div><div className="text-xs text-muted-foreground">Size</div><div className="font-medium">{formatBytes(selected.file_size)}</div></div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Detected columns & mapping</h3>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-border bg-muted/50"><th className="text-left px-3 py-2 font-medium text-muted-foreground">Column</th><th className="text-left px-3 py-2 font-medium text-muted-foreground">Mapped to</th></tr></thead>
                    <tbody>
                      {selected.columns_detected.map((c) => (
                        <tr key={c} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 font-mono">{c}</td>
                          <td className="px-3 py-2"><Badge variant="secondary" className="text-xs">{selected.mapping[c] ?? "custom"}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selected.custom_columns.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Custom variables</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.custom_columns.map((c) => (
                      <Badge key={c} variant="outline" className="text-xs font-mono">{`{{${c}}}`}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {selected.sample_rows.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Sample rows ({selected.sample_rows.length})</h3>
                  <div className="rounded-lg border border-border overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-border bg-muted/50">{selected.columns_detected.map((c) => (<th key={c} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{c}</th>))}</tr></thead>
                      <tbody>
                        {selected.sample_rows.map((row, i) => (
                          <tr key={i} className="border-b border-border last:border-0">
                            {selected.columns_detected.map((c) => (
                              <td key={c} className="px-3 py-2 whitespace-nowrap max-w-[200px] truncate">{row[c] ?? ""}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Files;
