

## Plan

### 1. Header always identical (public site header)
- Keep `Header.tsx` exactly as it is on every page (logged-in or not). It already shows "Botlio Email" + Home / Pricing / Features.
- When logged in, replace the right-side "Log in / Get Started" buttons with a single "Dashboard" button + avatar/email + "Log out".
- Header never shows app tabs (Sequences, Contacts, Senders, Files).

### 2. App tabs live inside the dashboard, not the header
- Create a new `AppLayout` component used by all protected pages (`/dashboard`, `/sequences`, `/contacts`, `/senders`, `/files`).
- Layout = the public `<Header />` on top + a secondary in-page tab bar (Dashboard · Sequences · Contacts · Senders · Files) under it + the page content.
- Remove the duplicate header currently inside `Dashboard.tsx`.
- Wrap the protected routes in `App.tsx` with `<AppLayout>`.

### 3. Auth gating
- `ProtectedRoute` already redirects to `/auth` if not logged in — keep it.
- Add gating to the dashboard tab bar: only render it when `user` exists (it lives inside `AppLayout` which is only used on protected routes, so this is automatic).
- On `/` (Index) and `/pricing`, if the user is logged in, the header's right side shows a "Dashboard" button instead of "Log in / Get Started".

### 4. Reusing variables across uploads (same list = same columns)
Right now when you upload a second file into an **existing** contact list, the `FileImportDialog` lets you map columns but doesn't surface the variables already on that list, so you might pick different keys than before and end up with `company` on row 1 and `company_name` on row 2.

Fix:
- When the import dialog opens with an existing `list_id`, fetch that list's `columns` (jsonb already stored on `contact_lists`).
- Show a **"Reuse existing variable"** dropdown next to each detected column header — populated with the list's existing variable keys. Picking one auto-fills the mapping target so the new file writes into the same `custom_fields` keys.
- After import, merge any new columns into `contact_lists.columns` so the union grows over time.

### 5. Files / out of scope
- I will not change business logic of sending, enrollment, runner, or canvas — only header/layout and the import-dialog reuse.

---

## How it will work after

- `/` and `/pricing` → public site with the Botlio header. If you're logged in, the header shows a "Dashboard" button on the right.
- `/dashboard`, `/sequences`, `/contacts`, `/senders`, `/files` → same Botlio header on top + a clean tab bar right under it for navigating between the four app sections. Logging out kicks you back to `/auth`.
- On the contacts page, opening "Import file" into an existing list shows the list's existing variables; you can pick one per column so re-uploads keep the same keys.

