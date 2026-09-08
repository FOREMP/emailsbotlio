import { createServer } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const port = Number(process.env.PORT || 3100)
const secret = process.env.LEAD_SOURCE_SHARED_SECRET || process.env.SCRAPER_SHARED_SECRET || ''
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '')
const mapsApiUrl = String(process.env.MAPS_API_URL || 'http://maps:8080').replace(/\/$/, '')
const dataDir = process.env.LEAD_WORKER_DATA_DIR || '/var/lib/botlio-leads'
const maxQueued = Math.max(1, Number(process.env.MAX_QUEUED_LEAD_JOBS || 10))
const timeoutMs = Math.max(180, Number(process.env.LEAD_JOB_TIMEOUT_SECONDS || 900)) * 1000
const queuePath = join(dataDir, 'queue.json')
let queue = []
let active = null
const cancelledJobs = new Set()

if (!secret) throw new Error('LEAD_SOURCE_SHARED_SECRET or SCRAPER_SHARED_SECRET is required')
if (!supabaseUrl) throw new Error('SUPABASE_URL is required')

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
async function readBody(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64_000) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
function validSignature(req, raw) {
  const timestamp = String(req.headers['x-botlio-timestamp'] || '')
  const signature = String(req.headers['x-botlio-signature'] || '')
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || Math.abs(Date.now() - seconds * 1000) > 5 * 60_000) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw.toString('utf8')}`).digest('hex')
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
function validateJob(value) {
  if (!value || typeof value !== 'object') throw new Error('invalid job')
  if (!/^[0-9a-f-]{36}$/i.test(String(value.job_id || ''))) throw new Error('invalid job_id')
  if (typeof value.query !== 'string' || value.query.trim().length < 3 || value.query.length > 180) throw new Error('invalid query')
  if (!['sv', 'en'].includes(value.language)) throw new Error('invalid language')
  const maxResults = Math.max(1, Math.min(150, Number(value.max_results) || 75))
  return { job_id: value.job_id, query: value.query.trim(), language: value.language, max_results: maxResults }
}
async function persistQueue() {
  await mkdir(dataDir, { recursive: true })
  const temp = `${queuePath}.tmp`
  await writeFile(temp, JSON.stringify({ queue, active }, null, 2), { mode: 0o600 })
  await rename(temp, queuePath)
}
async function restoreQueue() {
  await mkdir(dataDir, { recursive: true })
  try {
    const saved = JSON.parse(await readFile(queuePath, 'utf8'))
    queue = Array.isArray(saved.queue) ? saved.queue : []
    if (saved.active?.job_id) queue.unshift(saved.active)
  } catch { /* first start */ }
}
async function signBody(body) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  return { timestamp, signature: createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex') }
}
async function postSupabase(functionName, payload) {
  const body = JSON.stringify(payload)
  const { timestamp, signature } = await signBody(body)
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST', headers: {
      'content-type': 'application/json', 'X-Botlio-Timestamp': timestamp, 'X-Botlio-Signature': signature,
    }, body,
  })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${functionName} ${response.status}: ${value?.error || 'unknown error'}`)
  return value
}
async function fetchJson(url, init = {}) {
  const response = await fetch(url, init)
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Maps service ${response.status}: ${value?.message || value?.error || 'unknown error'}`)
  return value
}
async function submitMapsJob(job) {
  // The official web runner accepts this exact schema and stores its own
  // short-lived SQLite job state inside the private maps container.
  const value = await fetchJson(`${mapsApiUrl}/api/v1/jobs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      name: `botlio-${job.job_id}`,
      keywords: [job.query],
      lang: job.language,
      depth: 1,
      email: true,
      extra_reviews: false,
      max_time: Math.ceil(timeoutMs / 1000),
      fast_mode: false,
      radius: 10,
      zoom: 14,
    }),
  })
  const id = String(value.id || value.job_id || '')
  if (!id) throw new Error('Maps service returned no job ID')
  return id
}
function jobState(value) { return String(value?.Status || value?.status || '').toLowerCase() }
async function waitForMapsJob(id, job) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (job.cancel_requested || cancelledJobs.has(job.job_id)) throw new CancelledJobError()
    const job = await fetchJson(`${mapsApiUrl}/api/v1/jobs/${encodeURIComponent(id)}`)
    const state = jobState(job)
    if (state === 'ok' || state === 'completed') return job
    if (state === 'failed' || state === 'cancelled') throw new Error(`Maps job ${state}`)
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  throw new Error('Maps job timed out')
}
class CancelledJobError extends Error { constructor() { super('job cancelled'); this.name = 'CancelledJobError' } }
function isCancelled(job) { return Boolean(job?.cancel_requested || cancelledJobs.has(job?.job_id)) }
async function cancelMapsJob(mapsJobId) {
  if (!mapsJobId) return
  try {
    await fetchJson(`${mapsApiUrl}/api/v1/jobs/${encodeURIComponent(mapsJobId)}`, { method: 'DELETE' })
  } catch (error) {
    // The local cancellation flag still prevents imports if the Maps API has
    // already finished or does not support cancellation for this job state.
    console.warn('could not cancel Maps job', mapsJobId, error instanceof Error ? error.message : error)
  }
}
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]; const next = text[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') { field += '"'; i++ }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const headers = (rows.shift() || []).map((item) => item.trim())
  return rows.filter((items) => items.some(Boolean)).map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] || ''])))
}
async function downloadRows(mapsJobId, maxResults) {
  const response = await fetch(`${mapsApiUrl}/api/v1/jobs/${encodeURIComponent(mapsJobId)}/download`)
  if (!response.ok) throw new Error(`Maps CSV download ${response.status}`)
  return parseCsv(await response.text()).slice(0, maxResults)
}
async function ingestRows(job, rows) {
  const totals = { imported: 0, duplicates: 0, rejected: 0, failed: 0 }
  for (let index = 0; index < rows.length; index += 25) {
    if (isCancelled(job)) throw new CancelledJobError()
    const result = await postSupabase('ingest-sourced-leads', { job_id: job.job_id, rows: rows.slice(index, index + 25) })
    for (const key of Object.keys(totals)) totals[key] += Number(result[key] || 0)
  }
  return totals
}
async function runNext() {
  if (active || queue.length === 0) return
  active = queue.shift(); await persistQueue()
  const job = active
  try {
    await postSupabase('lead-scrape-status', { job_id: job.job_id, state: 'running' })
    if (isCancelled(job)) throw new CancelledJobError()
    const mapsJobId = await submitMapsJob(job)
    job.maps_job_id = mapsJobId; await persistQueue()
    if (isCancelled(job)) { await cancelMapsJob(mapsJobId); throw new CancelledJobError() }
    await postSupabase('lead-scrape-status', { job_id: job.job_id, state: 'running', worker_job_id: mapsJobId })
    await waitForMapsJob(mapsJobId, job)
    if (isCancelled(job)) throw new CancelledJobError()
    const rows = await downloadRows(mapsJobId, job.max_results)
    if (isCancelled(job)) throw new CancelledJobError()
    const totals = await ingestRows(job, rows)
    await postSupabase('lead-scrape-status', {
      job_id: job.job_id, state: 'completed', worker_job_id: mapsJobId,
      discovered_count: rows.length, imported_count: totals.imported, duplicate_count: totals.duplicates, rejected_count: totals.rejected,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isCancelled(job) || error instanceof CancelledJobError) {
      await cancelMapsJob(job.maps_job_id)
      await postSupabase('lead-scrape-status', { job_id: job.job_id, state: 'cancelled', error_message: 'Cancelled by user' }).catch((reportError) => console.error('status report failed', reportError))
    } else {
      console.error('lead job failed', job.job_id, message)
      await postSupabase('lead-scrape-status', { job_id: job.job_id, state: 'failed', error_message: message }).catch((reportError) => console.error('status report failed', reportError))
    }
  } finally {
    cancelledJobs.delete(job.job_id)
    active = null; await persistQueue(); void runNext()
  }
}

await restoreQueue(); void runNext()
createServer(async (req, res) => {
  try {
    const path = new URL(req.url || '/', 'http://localhost').pathname
    if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'botlio-lead-worker', active_job: active?.job_id || null, queued: queue.length })
    const cancelMatch = path.match(/^\/v1\/lead-jobs\/([0-9a-f-]{36})\/cancel$/i)
    if (req.method !== 'POST' || (path !== '/v1/lead-jobs' && !cancelMatch)) return json(res, 404, { error: 'not found' })
    const raw = await readBody(req)
    if (!validSignature(req, raw)) return json(res, 401, { ok: false, error: 'invalid request signature' })
    if (cancelMatch) {
      const jobId = cancelMatch[1]
      const body = JSON.parse(raw.toString('utf8'))
      if (body?.job_id !== jobId) return json(res, 400, { ok: false, error: 'job_id does not match URL' })
      const queuedIndex = queue.findIndex((item) => item.job_id === jobId)
      if (queuedIndex >= 0) {
        queue.splice(queuedIndex, 1); await persistQueue()
        await postSupabase('lead-scrape-status', { job_id: jobId, state: 'cancelled', error_message: 'Cancelled by user' })
        return json(res, 200, { ok: true, cancelled: true, queued: true })
      }
      if (active?.job_id === jobId) {
        active.cancel_requested = true; cancelledJobs.add(jobId); await persistQueue()
        await cancelMapsJob(active.maps_job_id)
        return json(res, 202, { ok: true, cancelled: true, active: true })
      }
      return json(res, 404, { ok: false, error: 'job is not queued or active' })
    }
    const job = validateJob(JSON.parse(raw.toString('utf8')))
    if (active?.job_id === job.job_id || queue.some((item) => item.job_id === job.job_id)) return json(res, 202, { ok: true, already_queued: true })
    if (queue.length >= maxQueued) return json(res, 429, { ok: false, error: 'lead worker queue is full' })
    queue.push(job); await persistQueue(); void runNext()
    return json(res, 202, { ok: true, queued: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json(res, 400, { ok: false, error: message })
  }
}).listen(port, '0.0.0.0', () => console.log(`Botlio lead worker listening on ${port}`))
