
-- Reset stuck enrollments (completed without ever sending) so user can re-enroll
DELETE FROM public.enrollments
WHERE status = 'completed' AND last_sent_at IS NULL;

-- Remove stray duplicate send_email node not wired into the active sequence
DELETE FROM public.sequence_nodes n
WHERE n.sequence_id = '560a3369-0467-4caf-a032-cf711bdeeb54'
  AND n.node_type = 'send_email'
  AND NOT EXISTS (SELECT 1 FROM public.sequence_edges e WHERE e.source_node_id = n.id)
  AND NOT EXISTS (SELECT 1 FROM public.sequence_edges e WHERE e.target_node_id = n.id);

-- Improve seed function: idempotent + always processes all domains
CREATE OR REPLACE FUNCTION public.seed_default_senders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  d record;
  total_inserted integer := 0;
  rc integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  FOR d IN SELECT domain, reply_to_email FROM public.sending_domains WHERE is_active = true LOOP
    INSERT INTO public.senders (user_id, from_name, from_email, reply_to, is_active)
    SELECT uid, 'Eric Wahlbom', 'eric@' || d.domain, d.reply_to_email, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.senders WHERE user_id = uid AND from_email = 'eric@' || d.domain
    );
    GET DIAGNOSTICS rc = ROW_COUNT;
    total_inserted := total_inserted + rc;

    INSERT INTO public.senders (user_id, from_name, from_email, reply_to, is_active)
    SELECT uid, 'Isak Andersson', 'isak@' || d.domain, d.reply_to_email, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.senders WHERE user_id = uid AND from_email = 'isak@' || d.domain
    );
    GET DIAGNOSTICS rc = ROW_COUNT;
    total_inserted := total_inserted + rc;
  END LOOP;

  RETURN total_inserted;
END;
$function$;
