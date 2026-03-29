import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Fish, Plus, Users, Upload, ArrowLeft, Trash2, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const Contacts = () => {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [newListName, setNewListName] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactForm, setContactForm] = useState({ first_name: "", last_name: "", email: "", phone: "" });

  // Fetch lists
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

  // Fetch contacts for selected list
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

  // Create list
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

  // Add contact
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

  // Delete list
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

  // Delete contact
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

  // CSV upload
  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedList) return;

    const text = await file.text();
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      toast.error("CSV must have a header row and at least one data row");
      return;
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const rows = lines.slice(1).map((line) => {
      const values = line.split(",").map((v) => v.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, i) => (row[h] = values[i] || ""));
      return row;
    });

    const contactsToInsert = rows.map((row) => ({
      user_id: user!.id,
      list_id: selectedList,
      first_name: row["first_name"] || row["firstname"] || row["first name"] || "",
      last_name: row["last_name"] || row["lastname"] || row["last name"] || "",
      email: row["email"] || "",
      phone: row["phone"] || row["phone_number"] || "",
    }));

    const { error } = await supabase.from("contacts").insert(contactsToInsert);
    if (error) {
      toast.error("Failed to import: " + error.message);
    } else {
      queryClient.invalidateQueries({ queryKey: ["contacts", selectedList] });
      toast.success(`Imported ${contactsToInsert.length} contacts!`);
    }
    e.target.value = "";
  };

  const selectedListData = lists.find((l) => l.id === selectedList);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <Fish className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>MailxSend</span>
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
        <div className="flex items-center gap-2 mb-6">
          <Link to="/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
            </Button>
          </Link>
        </div>

        {!selectedList ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Contact Lists</h1>
                <p className="text-muted-foreground text-sm mt-1">Organize your contacts into lists for targeted campaigns.</p>
              </div>
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
            </div>

            {listsLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : lists.length === 0 ? (
              <div className="rounded-xl border border-border bg-card shadow-card p-12 text-center">
                <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground text-sm mb-4">No contact lists yet. Create your first one to start importing contacts.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {lists.map((list) => (
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
                    <p className="text-xs text-muted-foreground mt-3">Created {new Date(list.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            )}
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
              </div>
              <div className="flex gap-2">
                <label>
                  <input type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
                  <Button variant="outline" size="sm" asChild>
                    <span><Upload className="h-4 w-4 mr-1.5" /> Import CSV</span>
                  </Button>
                </label>
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

            {contactsLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : contacts.length === 0 ? (
              <div className="rounded-xl border border-border bg-card shadow-card p-12 text-center">
                <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No contacts in this list yet. Add one manually or import a CSV.</p>
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
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((c) => (
                        <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{c.email || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{c.phone || "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteContact.mutate(c.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Contacts;
