import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Users, Upload, ArrowLeft, Trash2, ShieldX, ShieldOff, Settings2, Tag, Search, Move, Copy } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import FileImportDialog from "@/components/FileImportDialog";
import ListVariablesDialog from "@/components/ListVariablesDialog";

const Contacts = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newListName, setNewListName] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [contactForm, setContactForm] = useState({ first_name: "", last_name: "", email: "", phone: "" });
  const [overviewTab, setOverviewTab] = useState<"lists" | "suppressed" | "erasures">("lists");
  const [varsDialogOpen, setVarsDialogOpen] = useState(false);

  const { data: lists = [], isLoading: listsLoading } = useQuery({
    queryKey: ["contact_lists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_lists")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery({
    queryKey: ["contacts", selectedList],
    enabled: !!selectedList,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("list_id", selectedList!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: erasures = [], isLoading: erasuresLoading } = useQuery({
    queryKey: ["gdpr_erasures"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gdpr_erasures")
        .select("id, email_hash, reason, erased_at")
        .order("erased_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: suppressedEmails = [], isLoading: suppressedLoading } = useQuery({
    queryKey: ["suppressed_emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppressed_emails")
        .select("id, email, reason, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: lastContacted = {} } = useQuery({
    queryKey: ["last-contacted", selectedList, contacts.length],
    enabled: !!selectedList && contacts.length > 0,
    queryFn: async () => {
      const ids = contacts.map((c) => c.id);
      const { data } = await supabase
        .from("sent_emails")
        .select("contact_id, sent_at")
        .in("contact_id", ids)
        .eq("status", "sent")
        .order("sent_at", { ascending: false });
      const map: Record<string, string> = {};
      (data ?? []).forEach((r: any) => {
        if (r.contact_id && !map[r.contact_id]) map[r.contact_id] = r.sent_at;
      });
      return map;
    },
  });

  const createList = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("contact_lists").insert({
        user_id: user!.id,
        name: newListName,
        description: newListDesc || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact_lists"] });
      setNewListName("");
      setNewListDesc("");
      setListDialogOpen(false);
      toast.success("List created!");
    },
    onError: (e) => toast.error(e.message),
  });

  const addContact = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("contacts").insert({
        user_id: user!.id,
        list_id: selectedList!,
        ...contactForm,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", selectedList] });
      setContactForm({ first_name: "", last_name: "", email: "", phone: "" });
      setContactDialogOpen(false);
      toast.success("Contact added!");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteList = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contact_lists").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact_lists"] });
      setSelectedList(null);
      toast.success("List deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteContact = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", selectedList] });
      toast.success("Contact removed");
    },
    onError: (e) => toast.error(e.message),
  });

  const eraseContact = useMutation({
    mutationFn: async (c: { id: string; email: string | null }) => {
      if (!c.email) {
        const { error } = await supabase.from("contacts").delete().eq("id", c.id);
        if (error) throw error;
        return;
      }
      const emailLower = c.email.toLowerCase().trim();
      const enc = new TextEncoder().encode(emailLower);
      const buf = await crypto.subtle.digest("SHA-256", enc);
      const hash = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const { data: existingDnc } = await supabase
        .from("do_not_contact")
        .select("id")
        .eq("user_id", user!.id)
        .eq("email", emailLower)
        .maybeSingle();
      if (!existingDnc) {
        await supabase
          .from("do_not_contact")
          .insert({ user_id: user!.id, email: emailLower, reason: "gdpr_erasure" });
      }

      await supabase
        .from("enrollments")
        .update({ status: "unsubscribed", last_error: "gdpr_erasure" })
        .eq("user_id", user!.id)
        .eq("contact_id", c.id);

      await supabase.from("gdpr_erasures").insert({
        user_id: user!.id,
        email_hash: hash,
        reason: "user_requested",
      });

      const { error } = await supabase.from("contacts").delete().eq("id", c.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", selectedList] });
      queryClient.invalidateQueries({ queryKey: ["gdpr_erasures"] });
      toast.success("Contact erased — added to do-not-contact and audited");
    },
    onError: (e: any) => toast.error(e.message ?? "Erase failed"),
  });

  const [importing, setImporting] = useState(false);
  const handleFileImport = async (
    importedContacts: { first_name: string; last_name: string; email: string; phone: string; custom_fields: Record<string, string> }[],
    customColumns: string[],
    fileMeta: { name: string; size: number; type: string; headers: string[]; mapping: Record<string, string>; sampleRows: Record<string, string>[] }
  ) => {
    if (!selectedList) return;
    setImporting(true);
    try {
      const contactsToInsert = importedContacts.map((c) => ({
        user_id: user!.id,
        list_id: selectedList,
        first_name: c.first_name || null,
        last_name: c.last_name || null,
        email: c.email || null,
        phone: c.phone || null,
        custom_fields: Object.keys(c.custom_fields).length > 0 ? c.custom_fields : null,
      }));

      const { error } = await supabase.from("contacts").insert(contactsToInsert);
      if (error) throw error;

      const existingList = lists.find((l) => l.id === selectedList);
      const existingCols: string[] = Array.isArray((existingList as any)?.columns) ? (existingList as any).columns : [];
      const mergedCols = [...new Set([...existingCols, ...customColumns])];

      if (mergedCols.length > 0) {
        await supabase.from("contact_lists").update({ columns: mergedCols } as any).eq("id", selectedList);
      }

      await supabase.from("imported_files").insert({
        user_id: user!.id,
        list_id: selectedList,
        file_name: fileMeta.name,
        file_size: fileMeta.size,
        file_type: fileMeta.type,
        row_count: importedContacts.length,
        column_count: fileMeta.headers.length,
        imported_count: importedContacts.length,
        columns_detected: fileMeta.headers,
        mapping: fileMeta.mapping,
        custom_columns: customColumns,
        sample_rows: fileMeta.sampleRows.slice(0, 5),
      });

      queryClient.invalidateQueries({ queryKey: ["contacts", selectedList] });
      queryClient.invalidateQueries({ queryKey: ["contact_lists"] });
      queryClient.invalidateQueries({ queryKey: ["imported_files"] });
      setImportDialogOpen(false);
      toast.success(`Imported ${importedContacts.length} contacts!`);
    } catch (err: any) {
      toast.error("Import failed: " + err.message);
    } finally {
      setImporting(false);
    }
  };

  const selectedListData = lists.find((l) => l.id === selectedList);
  const listCustomColumns: string[] = Array.isArray((selectedListData as any)?.columns) ? (selectedListData as any).columns : [];
  const suppressedSet = new Set(suppressedEmails.map((item) => item.email.toLowerCase()));

  return (
    <>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/dashboard">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Button>
        </Link>
      </div>

      {!selectedList ? (
        <>
          <div className="flex items-center justify-between mb-6 gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
              <p className="text-muted-foreground text-sm mt-1">Manage contact lists and review everyone the system is blocking from future sends.</p>
            </div>
            {overviewTab === "lists" && (
              <Dialog open={listDialogOpen} onOpenChange={setListDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
                    <Plus className="h-4 w-4 mr-1.5" /> New List
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Contact List</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div>
                      <Label htmlFor="listName">List Name</Label>
                      <Input id="listName" value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="e.g. Newsletter Subscribers" />
                    </div>
                    <div>
                      <Label htmlFor="listDesc">Description (optional)</Label>
                      <Input id="listDesc" value={newListDesc} onChange={(e) => setNewListDesc(e.target.value)} placeholder="What is this list for?" />
                    </div>
                    <Button onClick={() => createList.mutate()} disabled={!newListName.trim() || createList.isPending} className="w-full">
                      {createList.isPending ? "Creating…" : "Create List"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          <Tabs value={overviewTab} onValueChange={(value) => setOverviewTab(value as "lists" | "suppressed" | "erasures") }>
            <TabsList>
              <TabsTrigger value="lists">Lists</TabsTrigger>
              <TabsTrigger value="suppressed">Suppressed</TabsTrigger>
              <TabsTrigger value="erasures">GDPR erasures</TabsTrigger>
            </TabsList>

            <TabsContent value="lists">
              {listsLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : lists.length === 0 ? (
                <div className="rounded-xl border border-border bg-card shadow-card p-12 text-center">
                  <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm mb-4">No contact lists yet. Create your first one to start importing contacts.</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {lists.map((list) => {
                    const cols: string[] = Array.isArray((list as any)?.columns) ? (list as any).columns : [];
                    return (
                      <div
                        key={list.id}
                        className="rounded-xl border border-border bg-card p-5 shadow-card hover:shadow-elevated transition-all cursor-pointer group"
                        onClick={() => setSelectedList(list.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">{list.name}</h3>
                            {list.description && <p className="text-sm text-muted-foreground mt-1">{list.description}</p>}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                            onClick={(e) => { e.stopPropagation(); deleteList.mutate(list.id); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {cols.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {cols.slice(0, 5).map((col) => (
                              <Badge key={col} variant="secondary" className="text-xs font-mono">
                                {`{{${col}}}`}
                              </Badge>
                            ))}
                            {cols.length > 5 && (
                              <Badge variant="outline" className="text-xs">+{cols.length - 5} more</Badge>
                            )}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-3">Created {new Date(list.created_at).toLocaleDateString()}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="suppressed">
              {suppressedLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : suppressedEmails.length === 0 ? (
                <div className="rounded-xl border border-border bg-card shadow-card p-12 text-center">
                  <ShieldX className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No suppressed emails yet.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reason</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Added</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suppressedEmails.map((item) => (
                          <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-3">{item.email}</td>
                            <td className="px-4 py-3">
                              <Badge variant="secondary">{item.reason || "suppressed"}</Badge>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                              {new Date(item.created_at).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="erasures">
              <p className="text-xs text-muted-foreground mb-3">
                Audit log of contacts erased under GDPR's right to be forgotten. Emails are stored
                as SHA-256 hashes — never as plaintext — so we can prove an erasure happened
                without keeping the personal data.
              </p>
              {erasuresLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : erasures.length === 0 ? (
                <div className="rounded-xl border border-border bg-card shadow-card p-12 text-center">
                  <ShieldOff className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No erasures recorded yet.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email hash (SHA-256)</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reason</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Erased at</th>
                        </tr>
                      </thead>
                      <tbody>
                        {erasures.map((row) => (
                          <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-3 font-mono text-xs">{row.email_hash.slice(0, 16)}…</td>
                            <td className="px-4 py-3">
                              <Badge variant="secondary">{row.reason || "user_requested"}</Badge>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                              {new Date(row.erased_at).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-6">
            <div>
              <button onClick={() => setSelectedList(null)} className="text-sm text-muted-foreground hover:text-foreground mb-1 flex items-center gap-1">
                <ArrowLeft className="h-3 w-3" /> Back to lists
              </button>
              <h1 className="text-2xl font-bold tracking-tight">{selectedListData?.name}</h1>
              {selectedListData?.description && <p className="text-muted-foreground text-sm mt-1">{selectedListData.description}</p>}
              {listCustomColumns.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {listCustomColumns.map((col) => (
                    <Badge key={col} variant="secondary" className="text-xs font-mono">
                      {`{{${col}}}`}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {listCustomColumns.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setVarsDialogOpen(true)}>
                  <Settings2 className="h-4 w-4 mr-1.5" /> Manage variables
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-1.5" /> Import File
              </Button>
              <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
                    <Plus className="h-4 w-4 mr-1.5" /> Add Contact
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Contact</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>First Name</Label>
                        <Input value={contactForm.first_name} onChange={(e) => setContactForm((f) => ({ ...f, first_name: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Last Name</Label>
                        <Input value={contactForm.last_name} onChange={(e) => setContactForm((f) => ({ ...f, last_name: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input type="email" value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Phone</Label>
                      <Input value={contactForm.phone} onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <Button onClick={() => addContact.mutate()} disabled={(!contactForm.email && !contactForm.phone) || addContact.isPending} className="w-full">
                      {addContact.isPending ? "Adding…" : "Add Contact"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <FileImportDialog
            open={importDialogOpen}
            onOpenChange={setImportDialogOpen}
            onImport={handleFileImport}
            importing={importing}
            existingColumns={listCustomColumns}
          />

          <ListVariablesDialog
            open={varsDialogOpen}
            onOpenChange={setVarsDialogOpen}
            listId={selectedList}
            variables={listCustomColumns}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["contact_lists"] });
              queryClient.invalidateQueries({ queryKey: ["contacts", selectedList] });
            }}
          />

          {contactsLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : contacts.length === 0 ? (
            <div className="rounded-xl border border-border bg-card shadow-card p-12 text-center">
              <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No contacts in this list yet. Add one manually or import a file.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Phone</th>
                      {listCustomColumns.map((col) => (
                        <th key={col} className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{col}</th>
                      ))}
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Last contacted</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((c) => {
                      const cf = (c.custom_fields as Record<string, string> | null) ?? {};
                      const lc = (lastContacted as Record<string, string>)[c.id];
                      const isSuppressed = !!c.email && suppressedSet.has(c.email.toLowerCase());
                      return (
                        <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{c.email || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{c.phone || "—"}</td>
                          {listCustomColumns.map((col) => (
                            <td key={col} className="px-4 py-3 text-muted-foreground">{cf[col] || "—"}</td>
                          ))}
                          <td className="px-4 py-3">
                            {isSuppressed ? <Badge variant="secondary">Suppressed</Badge> : <span className="text-muted-foreground/50">—</span>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                            {lc ? new Date(lc).toLocaleString() : <span className="text-muted-foreground/50">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="text-amber-700" title="Erase under GDPR (irreversible — also blocks future contact)">
                                    <ShieldOff className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Erase this contact (GDPR)?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This deletes the contact, adds {c.email || "their email"} to your
                                      Do-Not-Contact list, cancels any active enrollments, and records a
                                      hashed audit row. This action satisfies GDPR Art. 17 (right to be
                                      forgotten) and cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => eraseContact.mutate({ id: c.id, email: c.email })}
                                    >
                                      Erase permanently
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                              <Button variant="ghost" size="sm" className="text-destructive" title="Remove from this list (does not block future contact)" onClick={() => deleteContact.mutate(c.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
};

export default Contacts;
