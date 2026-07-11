import { useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Upload, FileSpreadsheet, AlertCircle, ShieldAlert, X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const STANDARD_FIELDS = ["email", "phone", "first_name", "last_name"] as const;

/** Convert any header to a safe template variable key: lowercase snake_case, alnum + underscore only. */
export function sanitizeVarKey(raw: string): string {
  const cleaned = raw
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "field";
}

/** Flatten one JSON record (one level) so nested objects become dot.path keys and arrays become JSON strings. */
function flattenRecord(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) {
      out[key] = "";
    } else if (Array.isArray(v)) {
      out[key] = v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
    } else if (typeof v === "object") {
      Object.assign(out, flattenRecord(v as Record<string, unknown>, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

const EMAIL_PATTERNS = ["email", "e-mail", "email_address", "emailaddress", "mail"];
const PHONE_PATTERNS = ["phone", "phone_number", "phonenumber", "tel", "telephone", "mobile", "cell"];
const FIRST_NAME_PATTERNS = ["first_name", "firstname", "first name", "fname", "given_name"];
const LAST_NAME_PATTERNS = ["last_name", "lastname", "last name", "lname", "surname", "family_name"];
const WEBSITE_PATTERNS = ["website", "web site", "url", "homepage", "home_page", "site", "domain", "hemsida", "webbsida", "webbplats", "web"];
/** Permanent custom variable key for a lead's website. Used by templates as {{website}} and by the site auditor. */
export const WEBSITE_KEY = "website";

type ColumnMapping = {
  // Standard fields, "skip", "custom" (new variable name = column header), or "reuse:<existing_key>"
  [header: string]: string;
};

interface ParsedData {
  headers: string[];
  rows: Record<string, string>[];
}

interface FileImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (
    contacts: { first_name: string; last_name: string; email: string; phone: string; custom_fields: Record<string, string> }[],
    customColumns: string[],
    fileMeta: { name: string; size: number; type: string; headers: string[]; mapping: Record<string, string>; sampleRows: Record<string, string>[] }
  ) => void;
  importing?: boolean;
  /** Variable keys already defined on the target list, so users can reuse them instead of inventing new keys. */
  existingColumns?: string[];
}

function autoDetectMapping(headers: string[], existingColumns: string[] = []): ColumnMapping {
  const mapping: ColumnMapping = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  const existingLower = existingColumns.map((c) => c.toLowerCase().trim());

  const assigned = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    const lower = lowerHeaders[i];
    if (!assigned.has("email") && EMAIL_PATTERNS.includes(lower)) {
      mapping[headers[i]] = "email";
      assigned.add("email");
    } else if (!assigned.has("phone") && PHONE_PATTERNS.includes(lower)) {
      mapping[headers[i]] = "phone";
      assigned.add("phone");
    } else if (!assigned.has("first_name") && FIRST_NAME_PATTERNS.includes(lower)) {
      mapping[headers[i]] = "first_name";
      assigned.add("first_name");
    } else if (!assigned.has("last_name") && LAST_NAME_PATTERNS.includes(lower)) {
      mapping[headers[i]] = "last_name";
      assigned.add("last_name");
    } else if (!assigned.has("website") && WEBSITE_PATTERNS.includes(lower)) {
      mapping[headers[i]] = "website";
      assigned.add("website");
    } else {
      // Try to match an existing custom column by name (case-insensitive)
      const matchIdx = existingLower.indexOf(lower);
      if (matchIdx >= 0) {
        mapping[headers[i]] = `reuse:${existingColumns[matchIdx]}`;
      } else {
        mapping[headers[i]] = "custom";
      }
    }
  }

  return mapping;
}

function parseFile(file: File): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isJson = /\.json$/i.test(file.name) || file.type === "application/json";

    reader.onload = (e) => {
      try {
        if (isJson) {
          const text = typeof e.target!.result === "string"
            ? (e.target!.result as string)
            : new TextDecoder().decode(e.target!.result as ArrayBuffer);
          const parsed = JSON.parse(text);
          // Accept: array of objects, {data: [...]}, {contacts: [...]}, {results: [...]}
          let arr: any[] | null = null;
          if (Array.isArray(parsed)) arr = parsed;
          else if (parsed && typeof parsed === "object") {
            for (const k of ["data", "contacts", "results", "items", "records", "rows"]) {
              if (Array.isArray(parsed[k])) { arr = parsed[k]; break; }
            }
          }
          if (!arr || arr.length === 0) {
            reject(new Error("JSON must be an array of objects (or an object with a 'data'/'contacts' array)."));
            return;
          }
          const rows = arr.map((row) => (row && typeof row === "object" ? flattenRecord(row) : { value: String(row) }));
          // Union of keys across all rows so we don't miss columns present only in later rows
          const headerSet = new Set<string>();
          rows.forEach((r) => Object.keys(r).forEach((k) => headerSet.add(k)));
          const headers = Array.from(headerSet);
          // Make sure every row has every header
          rows.forEach((r) => headers.forEach((h) => { if (!(h in r)) r[h] = ""; }));
          resolve({ headers, rows });
          return;
        }

        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

        if (json.length === 0) {
          reject(new Error("File is empty or has no data rows."));
          return;
        }

        const headers = Object.keys(json[0]);
        const rows = json.map((row) => {
          const mapped: Record<string, string> = {};
          headers.forEach((h) => (mapped[h] = String(row[h] ?? "")));
          return mapped;
        });

        resolve({ headers, rows });
      } catch (err: any) {
        reject(new Error(isJson
          ? `Failed to parse JSON: ${err?.message ?? "invalid JSON"}`
          : "Failed to parse file. Make sure it's a valid CSV or Excel file."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    if (isJson) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

export default function FileImportDialog({ open, onOpenChange, onImport, importing, existingColumns = [] }: FileImportDialogProps) {
  const { user } = useAuth();
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  /** For headers mapped to "custom": the user-controlled variable name (sanitized snake_case). */
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [fileMeta, setFileMeta] = useState<{ size: number; type: string }>({ size: 0, type: "" });
  const [autopilot, setAutopilot] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("autopilot_skip_dnc") === "true";
  });
  const [dncMatches, setDncMatches] = useState<string[] | null>(null);
  const [pendingImport, setPendingImport] = useState<null | {
    contacts: any[]; customColumns: string[]; meta: any;
  }>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("autopilot_skip_dnc", autopilot ? "true" : "false");
    }
  }, [autopilot]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await parseFile(file);
      setParsed(data);
      const auto = autoDetectMapping(data.headers, existingColumns);
      setMapping(auto);
      // Pre-fill custom variable names with sanitized header
      const names: Record<string, string> = {};
      data.headers.forEach((h) => { if (auto[h] === "custom") names[h] = sanitizeVarKey(h); });
      setCustomNames(names);
      setFileName(file.name);
      setFileMeta({ size: file.size, type: file.type || file.name.split(".").pop() || "" });
    } catch (err: any) {
      toast.error(err.message);
    }
    e.target.value = "";
  }, [existingColumns]);

  const updateMapping = (header: string, value: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      const uniqueRoles = ["email", "phone", "first_name", "last_name", "website"];
      if (uniqueRoles.includes(value)) {
        for (const key of Object.keys(next)) {
          if (next[key] === value) next[key] = "custom";
        }
      }
      next[header] = value;
      return next;
    });
    // Auto-fill name slot when switching to custom
    if (value === "custom") {
      setCustomNames((prev) => prev[header] ? prev : { ...prev, [header]: sanitizeVarKey(header) });
    }
  };

  const updateCustomName = (header: string, raw: string) => {
    setCustomNames((prev) => ({ ...prev, [header]: sanitizeVarKey(raw) }));
  };

  const hasEmail = Object.values(mapping).includes("email");

  /** Resolved variable key for a given header (only meaningful for custom/reuse/website). */
  const resolveKey = (header: string): string | null => {
    const m = mapping[header];
    if (m === "custom") return customNames[header] || sanitizeVarKey(header);
    if (m === "website") return WEBSITE_KEY;
    if (typeof m === "string" && m.startsWith("reuse:")) return m.slice("reuse:".length);
    return null;
  };

  const customColumns = parsed
    ? Array.from(new Set(parsed.headers.map(resolveKey).filter((v): v is string => !!v)))
    : [];

  // Detect duplicate variable names across columns (collision warning)
  const keyCounts: Record<string, number> = {};
  parsed?.headers.forEach((h) => {
    const k = resolveKey(h);
    if (k) keyCounts[k] = (keyCounts[k] ?? 0) + 1;
  });
  const hasCollisions = Object.values(keyCounts).some((n) => n > 1);

  const resetState = () => {
    setParsed(null);
    setMapping({});
    setCustomNames({});
    setFileName("");
    setFileMeta({ size: 0, type: "" });
  };

  const buildContacts = () => {
    if (!parsed) return [] as any[];
    return parsed.rows.map((row) => {
      const contact: any = { first_name: "", last_name: "", email: "", phone: "", custom_fields: {} as Record<string, string> };
      for (const header of parsed.headers) {
        const role = mapping[header];
        if (role === "skip") continue;
        if (role === "custom") {
          const key = customNames[header] || sanitizeVarKey(header);
          if (row[header]) contact.custom_fields[key] = row[header];
        } else if (role === "website") {
          if (row[header]) contact.custom_fields[WEBSITE_KEY] = row[header];
        } else if (typeof role === "string" && role.startsWith("reuse:")) {
          const key = role.slice("reuse:".length);
          if (row[header]) contact.custom_fields[key] = row[header];
        } else {
          contact[role] = row[header];
        }
      }
      return contact;
    });
  };

  const finalizeImport = (contacts: any[]) => {
    onImport(contacts, customColumns, {
      name: fileName,
      size: fileMeta.size,
      type: fileMeta.type,
      headers: parsed!.headers,
      mapping: mapping as Record<string, string>,
      sampleRows: parsed!.rows.slice(0, 5),
    });
    resetState();
  };

  const handleConfirm = async () => {
    if (!parsed) return;
    const contacts = buildContacts();

    // Pre-check: are any of these emails on the user's do_not_contact list?
    const emails = Array.from(
      new Set(
        contacts
          .map((c) => (c.email || "").toLowerCase().trim())
          .filter((e) => !!e),
      ),
    );

    let dncSet = new Set<string>();
    if (user && emails.length > 0) {
      const { data } = await supabase
        .from("do_not_contact")
        .select("email")
        .eq("user_id", user.id)
        .in("email", emails);
      dncSet = new Set((data ?? []).map((r: any) => (r.email as string).toLowerCase()));
    }

    if (dncSet.size === 0) {
      finalizeImport(contacts);
      return;
    }

    const matches = Array.from(dncSet);

    if (autopilot) {
      const filtered = contacts.filter((c) => !dncSet.has((c.email || "").toLowerCase().trim()));
      toast.success(`Skipped ${matches.length} unsubscribed contact${matches.length === 1 ? "" : "s"}`);
      finalizeImport(filtered);
      return;
    }

    setDncMatches(matches);
    setPendingImport({ contacts, customColumns, meta: null });
  };

  const handleDncSkip = () => {
    if (!pendingImport || !dncMatches) return;
    const dncSet = new Set(dncMatches.map((e) => e.toLowerCase()));
    const filtered = pendingImport.contacts.filter(
      (c) => !dncSet.has((c.email || "").toLowerCase().trim()),
    );
    toast.success(`Skipped ${dncMatches.length} unsubscribed contact${dncMatches.length === 1 ? "" : "s"}`);
    setDncMatches(null);
    setPendingImport(null);
    finalizeImport(filtered);
  };

  const handleDncImportAnyway = () => {
    if (!pendingImport) return;
    setDncMatches(null);
    const all = pendingImport.contacts;
    setPendingImport(null);
    finalizeImport(all);
  };

  const handleClose = (val: boolean) => {
    if (!val) resetState();
    onOpenChange(val);
  };

  const previewRows = parsed?.rows.slice(0, 4) ?? [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
        </DialogHeader>

        {!parsed ? (
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-12 cursor-pointer hover:border-primary/50 transition-colors">
            <Upload className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium mb-1">Drop a file or click to browse</p>
            <p className="text-xs text-muted-foreground">Supports CSV, Excel (.xlsx, .xls) and JSON (.json)</p>
            <input type="file" accept=".csv,.xlsx,.xls,.json,application/json" className="hidden" onChange={handleFileSelect} />
          </label>
        ) : (
          <div className="space-y-5">
            {/* File info */}
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{fileName}</span>
              <span className="text-muted-foreground">— {parsed.rows.length} rows, {parsed.headers.length} columns</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={resetState}>
                Change file
              </Button>
            </div>

            {/* Column mapping */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Map columns to variables</h3>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setMapping((prev) => {
                        const next = { ...prev };
                        for (const h of parsed.headers) {
                          const role = next[h];
                          if (role !== "email" && role !== "phone" && role !== "first_name" && role !== "last_name" && role !== "website") {
                            next[h] = "skip";
                          }
                        }
                        return next;
                      });
                    }}
                  >
                    Skip all custom
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setMapping(autoDetectMapping(parsed.headers, existingColumns))}
                  >
                    Reset
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Standard fields (email, phone, name) are stored on the contact. Anything else becomes a
                <strong> custom variable</strong> you can use in templates as <code>{"{{name}}"}</code>.
                Click the <X className="h-3 w-3 inline align-text-bottom" /> on any row to skip that column from the import.
                {existingColumns.length > 0 && " Pick \"Reuse\" to merge into a variable that already exists on this list."}
              </p>
              <div className="grid gap-2">
                {parsed.headers.map((header) => {
                  const m = mapping[header] || "custom";
                  const isReuse = typeof m === "string" && m.startsWith("reuse:");
                  const reusedKey = isReuse ? m.slice("reuse:".length) : null;
                  const customKey = customNames[header] || sanitizeVarKey(header);
                  const isDup = m === "custom" && (keyCounts[customKey] ?? 0) > 1;
                  const isSkipped = m === "skip";

                  if (isSkipped) {
                    return (
                      <div key={header} className="flex flex-wrap items-center gap-2 opacity-60">
                        <span className="text-sm font-mono w-40 truncate shrink-0 line-through" title={header}>{header}</span>
                        <Badge variant="outline" className="text-xs">Skipped</Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-7 text-xs gap-1"
                          onClick={() => updateMapping(header, "custom")}
                        >
                          <Plus className="h-3 w-3" /> Include
                        </Button>
                      </div>
                    );
                  }

                  return (
                    <div key={header} className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-mono w-40 truncate shrink-0" title={header}>{header}</span>
                      <Select value={m} onValueChange={(val) => updateMapping(header, val)}>
                        <SelectTrigger className="w-52 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">📧 Email</SelectItem>
                          <SelectItem value="phone">📱 Phone</SelectItem>
                          <SelectItem value="first_name">👤 First Name</SelectItem>
                          <SelectItem value="last_name">👤 Last Name</SelectItem>
                          <SelectItem value="website">🌐 Website (permanent variable)</SelectItem>
                          <SelectItem value="custom">🏷️ New custom variable</SelectItem>
                          {existingColumns.map((col) => (
                            <SelectItem key={col} value={`reuse:${col}`}>♻️ Reuse: {col}</SelectItem>
                          ))}
                          <SelectItem value="skip">⏭️ Skip</SelectItem>
                        </SelectContent>
                      </Select>
                      {m === "custom" && (
                        <>
                          <Input
                            value={customNames[header] ?? sanitizeVarKey(header)}
                            onChange={(e) => updateCustomName(header, e.target.value)}
                            className="h-8 w-44 text-xs font-mono"
                            placeholder="variable_name"
                          />
                          <Badge variant={isDup ? "destructive" : "secondary"} className="text-xs font-mono">
                            {`{{${customKey}}}`}
                          </Badge>
                        </>
                      )}
                      {isReuse && (
                        <Badge variant="outline" className="text-xs font-mono">→ {`{{${reusedKey}}}`}</Badge>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Skip this column"
                        onClick={() => updateMapping(header, "skip")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              {hasCollisions && (
                <div className="mt-3 flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Two or more columns resolve to the same variable name. Rename one of them — the later column will overwrite the earlier one for each contact.</span>
                </div>
              )}
            </div>

            {!hasEmail && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>No column mapped to Email. You'll need email for email campaigns.</span>
              </div>
            )}

            {/* Preview table */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Preview ({Math.min(4, parsed.rows.length)} of {parsed.rows.length} rows)</h3>
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      {parsed.headers.filter((h) => mapping[h] !== "skip").map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        {parsed.headers.filter((h) => mapping[h] !== "skip").map((h) => (
                          <td key={h} className="px-3 py-2 whitespace-nowrap max-w-[200px] truncate">{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Custom variables summary */}
            {customColumns.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Custom variables available in templates</h3>
                <div className="flex flex-wrap gap-1.5">
                  {customColumns.map((col) => (
                    <Badge key={col} variant="outline" className="text-xs font-mono">
                      {"{{" + col + "}}"}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                <div>
                  <Label htmlFor="autopilot-dnc" className="text-sm font-medium cursor-pointer">Autopilot: skip unsubscribed</Label>
                  <p className="text-xs text-muted-foreground">Automatically remove contacts on your Do-Not-Contact list, no prompt.</p>
                </div>
              </div>
              <Switch id="autopilot-dnc" checked={autopilot} onCheckedChange={setAutopilot} />
            </div>

            <Button onClick={handleConfirm} disabled={importing} className="w-full">
              {importing ? "Importing…" : `Import ${parsed.rows.length} contacts`}
            </Button>
          </div>
        )}
      </DialogContent>

      <AlertDialog open={!!dncMatches} onOpenChange={(o) => { if (!o) { setDncMatches(null); setPendingImport(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              {dncMatches?.length} unsubscribed contact{dncMatches?.length === 1 ? "" : "s"} found
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  These addresses previously unsubscribed from your emails. Contacting them again may damage your sender reputation.
                </p>
                <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 text-xs font-mono">
                  {dncMatches?.map((e) => <div key={e}>{e}</div>)}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDncImportAnyway}>Import anyway</AlertDialogCancel>
            <AlertDialogAction onClick={handleDncSkip}>Skip these contacts</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
