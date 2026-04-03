import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const STANDARD_FIELDS = ["email", "phone", "first_name", "last_name"] as const;

const EMAIL_PATTERNS = ["email", "e-mail", "email_address", "emailaddress", "mail"];
const PHONE_PATTERNS = ["phone", "phone_number", "phonenumber", "tel", "telephone", "mobile", "cell"];
const FIRST_NAME_PATTERNS = ["first_name", "firstname", "first name", "fname", "given_name"];
const LAST_NAME_PATTERNS = ["last_name", "lastname", "last name", "lname", "surname", "family_name"];

type ColumnMapping = {
  [header: string]: "email" | "phone" | "first_name" | "last_name" | "custom" | "skip";
};

interface ParsedData {
  headers: string[];
  rows: Record<string, string>[];
}

interface FileImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (contacts: { first_name: string; last_name: string; email: string; phone: string; custom_fields: Record<string, string> }[], customColumns: string[]) => void;
  importing?: boolean;
}

function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

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
    } else {
      mapping[headers[i]] = "custom";
    }
  }

  return mapping;
}

function parseFile(file: File): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
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
      } catch {
        reject(new Error("Failed to parse file. Make sure it's a valid CSV or Excel file."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

export default function FileImportDialog({ open, onOpenChange, onImport, importing }: FileImportDialogProps) {
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fileName, setFileName] = useState("");

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await parseFile(file);
      setParsed(data);
      setMapping(autoDetectMapping(data.headers));
      setFileName(file.name);
    } catch (err: any) {
      toast.error(err.message);
    }
    e.target.value = "";
  }, []);

  const updateMapping = (header: string, value: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      // If assigning a standard field, unassign it from any other column
      if (value !== "custom" && value !== "skip") {
        for (const key of Object.keys(next)) {
          if (next[key] === value) next[key] = "custom";
        }
      }
      next[header] = value as any;
      return next;
    });
  };

  const hasEmail = Object.values(mapping).includes("email");
  const customColumns = parsed
    ? parsed.headers.filter((h) => mapping[h] === "custom")
    : [];

  const handleConfirm = () => {
    if (!parsed) return;

    const contacts = parsed.rows.map((row) => {
      const contact: any = { first_name: "", last_name: "", email: "", phone: "", custom_fields: {} as Record<string, string> };
      for (const header of parsed.headers) {
        const role = mapping[header];
        if (role === "skip") continue;
        if (role === "custom") {
          if (row[header]) contact.custom_fields[header] = row[header];
        } else {
          contact[role] = row[header];
        }
      }
      return contact;
    });

    onImport(contacts, customColumns);
  };

  const handleClose = (val: boolean) => {
    if (!val) {
      setParsed(null);
      setMapping({});
      setFileName("");
    }
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
            <p className="text-xs text-muted-foreground">Supports CSV and Excel (.xlsx, .xls)</p>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileSelect} />
          </label>
        ) : (
          <div className="space-y-5">
            {/* File info */}
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{fileName}</span>
              <span className="text-muted-foreground">— {parsed.rows.length} rows, {parsed.headers.length} columns</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setParsed(null); setMapping({}); setFileName(""); }}>
                Change file
              </Button>
            </div>

            {/* Column mapping */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Map columns</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Assign which column is email, phone, etc. Unmapped columns become custom variables you can use in templates like {"{{column_name}}"}.
              </p>
              <div className="grid gap-2">
                {parsed.headers.map((header) => (
                  <div key={header} className="flex items-center gap-3">
                    <span className="text-sm font-mono w-40 truncate shrink-0" title={header}>{header}</span>
                    <Select value={mapping[header] || "custom"} onValueChange={(val) => updateMapping(header, val)}>
                      <SelectTrigger className="w-44 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">📧 Email</SelectItem>
                        <SelectItem value="phone">📱 Phone</SelectItem>
                        <SelectItem value="first_name">👤 First Name</SelectItem>
                        <SelectItem value="last_name">👤 Last Name</SelectItem>
                        <SelectItem value="custom">🏷️ Custom Variable</SelectItem>
                        <SelectItem value="skip">⏭️ Skip</SelectItem>
                      </SelectContent>
                    </Select>
                    {mapping[header] === "custom" && (
                      <Badge variant="secondary" className="text-xs">{"{{" + header + "}}"}</Badge>
                    )}
                  </div>
                ))}
              </div>
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

            <Button onClick={handleConfirm} disabled={importing} className="w-full">
              {importing ? "Importing…" : `Import ${parsed.rows.length} contacts`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
