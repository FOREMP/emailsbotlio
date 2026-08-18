import { createClient } from 'npm:@supabase/supabase-js@2'

// 1x1 transparent GIF
const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
])

const pixelHeaders = {
  'Content-Type': 'image/gif',
  'Content-Length': String(PIXEL.byteLength),
  // Normal-looking image caching. Aggressive no-store/Pragma/Expires headers on
  // a 1x1 GIF are a tracker fingerprint; private + must-revalidate still gives
  // us the open event through Gmail's image proxy.
  'Cache-Control': 'private, max-age=0, must-revalidate',
  'Access-Control-Allow-Origin': '*',
}

// Accept both the legacy ?m=<id> form and the asset-style /o/<id>.gif path.
function extractMessageId(url: URL): string | null {
  const q = url.searchParams.get('m')
  if (q) return q
  const seg = url.pathname.split('/').filter(Boolean).pop() ?? ''
  const m = seg.match(/^([0-9a-f-]{16,})\.gif$/i)
  return m ? m[1] : null
}

Deno.serve(async (req) => {
  // Always return the pixel; tracking is best-effort
  try {
    const url = new URL(req.url)
    const messageId = extractMessageId(url)

    if (messageId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      // Look up the email
      const { data: row } = await supabase
        .from('sent_emails')
        .select('id, user_id, contact_id, enrollment_id, opened_at, open_count')
        .eq('message_id', messageId)
        .maybeSingle()

      if (row) {
        const isFirst = !row.opened_at
        const now = new Date().toISOString()
        await supabase
          .from('sent_emails')
          .update({
            opened_at: row.opened_at ?? now,
            last_opened_at: now,
            open_count: (row.open_count ?? 0) + 1,
          })
          .eq('id', row.id)

        if (isFirst && row.user_id && row.contact_id) {
          // Best-effort activity log; ignore failures
          await supabase.from('contact_activity').insert({
            user_id: row.user_id,
            contact_id: row.contact_id,
            activity_type: 'email_opened',
            metadata: {
              message_id: messageId,
              enrollment_id: row.enrollment_id,
              user_agent: req.headers.get('user-agent') ?? null,
            },
          })
        }
      }
    }
  } catch (_e) {
    // Swallow — pixel must always render
  }
  return new Response(PIXEL, { status: 200, headers: pixelHeaders })
})
