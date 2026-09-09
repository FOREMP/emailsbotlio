-- Keep foreign-key maintenance cheap when contacts or enrollments are removed.
-- The sender and sequence relations are already covered by the active-capacity
-- indexes created with the reservation table.

create index if not exists email_send_reservations_enrollment_idx
  on public.email_send_reservations (enrollment_id);

create index if not exists email_send_reservations_contact_idx
  on public.email_send_reservations (contact_id)
  where contact_id is not null;
