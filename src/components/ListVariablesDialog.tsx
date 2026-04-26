import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { sanitizeVarKey } from "./FileImportDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: string;
  variables: string[];
  onSaved: () => void;
}

type Row = {
  /** Original key (null = newly added). */
  original: string | null;
  /** Edited key (sanitized on save). */
  current: string;
  /** Marked for deletion. */
  remove: boolean;
};

/**
 * Lets the user rename or delete the custom variables on a contact list.
 * On save: rewrites every contact's custom_fields for renames, drops removed keys,
 * and updates contact_lists.columns to reflect the new set.
 */
export default function ListVariablesDialog({ open, onOpenChange, listId, variables, onSaved }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setRows(variables.map((v) => ({ original: v, current: v, remove: false })));
    }
  }, [open, variables]);

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, { original: null, current: "", remove: false }]);
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  // Validate keys + collisions
  const sanitized = rows.map((r) => ({ ...r, sanitized: sanitizeVarKey(r.current) }));
  const activeKeys = sanitized.filter((r) => !r.remove && r.current.trim()).map((r) => r.sanitized);
  const collisions = new Set(activeKeys.filter((k, i) => activeKeys.indexOf(k) !== i));

  const handleSave = async () => {
    if (!user) return;
    if (collisions.size > 0) {
      toast.error("Two variables share the same name — rename them first.");
      return;
    }

    setSaving(true);
    try {
      // Build rename map (only renames where original != sanitized) and removal list
      const renames: Record<string, string> = {};
      const removals = new Set<string>();
      for (const r of sanitized) {
        if (r.original && r.remove) { removals.add(r.original); continue; }
        if (r.original && r.sanitized && r.original !== r.sanitized) {
          renames[r.original] = r.sanitized;
        }
      }

      const finalCols = Array.from(new Set(activeKeys.filter(Boolean)));

      // Apply changes to every contact in the list (only if there's something to do)
      if (Object.keys(renames).length > 0 || removals.size > 0) {
        const { data: contacts, error: cErr } = await supabase
          .from("contacts")
          .select("id, custom_fields")
          .eq("user_id", user.id)
          .eq("list_id", listId);
        if (cErr) throw cErr;

        const updates = (contacts ?? [])
          .map((c) => {
            const cf = (c.custom_fields as Record<string, string> | null) ?? {};
            let changed = false;
            const next: Record<string, string> = { ...cf };
            for (const key of removals) {
              if (key in next) { delete next[key]; changed = true; }
            }
            for (const [from, to] of Object.entries(renames)) {
              if (from in next) {
                next[to] = next[from];
                delete next[from];
                changed = true;
              }
            }
            return changed ? { id: c.id, custom_fields: next } : null;
          })
          .filter((u): u is { id: string; custom_fields: Record<string, string> } => !!u);

        // Update contacts in batches
        for (const u of updates) {
          const { error } = await supabase
            .from("contacts")
            .update({ custom_fields: u.custom_fields })
            .eq("id", u.id);
          if (error) throw error;
        }
      }

      // Update list columns
      const { error: lErr } = await supabase
        .from("contact_lists")
        .update({ columns: finalCols } as any)
        .eq("id", listId);
      if (lErr) throw lErr;

      toast.success("Variables updated");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update variables");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage list variables</DialogTitle>
          <DialogDescription>
            Rename or remove custom variables on this list. Renames update every contact's stored value.
            Removing a variable deletes that field from every contact in this list — this can't be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
          {sanitized.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">No custom variables yet. Add one below.</p>
          )}
          {sanitized.map((r, i) => {
            const isCollision = collisions.has(r.sanitized) && !r.remove;
            return (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={r.current}
                  onChange={(e) => updateRow(i, { current: e.target.value })}
                  placeholder="variable_name"
                  className={`h-9 text-sm font-mono ${r.remove ? "line-through opacity-50" : ""}`}
                  disabled={r.remove}
                />
                <Badge variant={isCollision ? "destructive" : "secondary"} className="text-xs font-mono shrink-0">
                  {`{{${r.sanitized || "…"}}}`}
                </Badge>
                {r.original ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={r.remove ? "text-muted-foreground" : "text-destructive"}
                    onClick={() => updateRow(i, { remove: !r.remove })}
                    title={r.remove ? "Undo remove" : "Remove from all contacts"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeRow(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" /> Add variable
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || collisions.size > 0}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>

        {collisions.size > 0 && (
          <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Duplicate variable names — each name must be unique.</span>
          </div>
        )}

        {!user && (
          <p className="text-xs text-destructive">You must be signed in to edit variables.</p>
        )}

        <Label className="text-xs text-muted-foreground">
          Tip: variable names are auto-cleaned to lowercase snake_case (spaces and symbols become underscores).
        </Label>
      </DialogContent>
    </Dialog>
  );
}
