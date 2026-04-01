

## Smart File Upload with Dynamic Variable Detection

### Problem
Currently, CSV upload only maps hardcoded columns (first_name, last_name, email, phone). Users need the ability to upload any CSV/Excel file, have the system detect ALL columns as usable variables (e.g. `{{company}}`, `{{order_id}}`, `{{city}}`), and store them so they can be referenced later in email/SMS templates.

### How It Works (User Flow)

1. User navigates to a contact list and clicks "Import File"
2. User selects a CSV or XLSX file
3. System parses the file, extracts all column headers, and shows a **preview screen**:
   - Displays detected columns and sample data (first 3-5 rows)
   - User maps which column is **email** (required for email campaigns) and which is **phone** (required for SMS)
   - All other columns are automatically saved as custom variables
4. User confirms the import
5. Contacts are saved with `email`, `phone`, `first_name`, `last_name` in their dedicated columns, and everything else goes into the `custom_fields` JSONB column
6. The list's detected variables are stored on the `contact_lists` table so the campaign builder knows what `{{variables}}` are available

### Database Change

Add a `columns` JSONB column to `contact_lists` to store the detected variable names for that list:

```sql
ALTER TABLE contact_lists
ADD COLUMN columns jsonb DEFAULT '[]'::jsonb;
```

This stores an array like `["company", "city", "order_id", "loyalty_tier"]` — the extra fields beyond the standard ones.

### Frontend Changes

**1. Add `xlsx` npm package** for parsing Excel files alongside CSV.

**2. New component: `FileImportDialog`** (`src/components/FileImportDialog.tsx`)
- Accepts CSV or XLSX files
- Parses headers and first few rows for preview
- Shows a mapping UI:
  - Auto-detects `email`, `phone`, `first_name`, `last_name` columns by common name patterns
  - Lets user manually assign which column maps to email/phone if auto-detect fails
  - All remaining columns become custom variables stored in `custom_fields`
- Shows a preview table of the parsed data
- On confirm: inserts contacts and updates the list's `columns` field

**3. Update `Contacts.tsx`**
- Replace the current raw CSV handler with the new `FileImportDialog`
- Show detected variables as badges/tags on each list card (e.g. "company", "city")
- Display custom field values in the contacts table

### Data Storage Strategy

Each contact row stores extra columns in `custom_fields` JSONB:
```json
{
  "company": "Acme Corp",
  "city": "Berlin", 
  "order_id": "ORD-123"
}
```

The parent `contact_lists.columns` stores the variable names so the campaign builder can offer `{{company}}`, `{{city}}`, `{{order_id}}` as insertable variables without scanning all contacts.

### Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Add `columns` jsonb to `contact_lists` |
| `src/components/FileImportDialog.tsx` | New — file upload, parse, preview, column mapping |
| `src/pages/Contacts.tsx` | Replace CSV handler, show variables on list cards, show custom fields in table |
| `package.json` | Add `xlsx` dependency |

