

## MiroFish Simulation Engine - Build Plan

### What We're Building

A system where users upload seed materials (PDFs, images, text), define a question, and run an AI simulation across thousands of synthetic personas to get a prediction report with live progress tracking.

### Phase 1: Database & File Storage (do first)

Create the core tables and a storage bucket for uploaded files.

**New tables:**
- `simulations` - id, user_id, title, question, status (draft/processing_materials/generating_agents/running/completed/failed), agent_count, created_at, updated_at
- `seed_materials` - id, simulation_id, user_id, type (pdf/image/text), content (text content or description), file_path (storage ref), created_at
- `agents` - id, simulation_id, name, persona (jsonb - income, behavior, traits, goals), response (text - their simulation answer), created_at
- `reports` - id, simulation_id, user_id, summary, full_report (text/markdown), insights (jsonb), created_at

**Storage bucket:** `seed-materials` (private, with RLS so users can only access their own files)

### Phase 2: Simulation Creation UI (do second)

A multi-step "New Simulation" flow:

1. **Upload step** - Drag-and-drop zone for PDFs, images, and a text input for manual info. Files go to Supabase Storage, text goes to `seed_materials` table.
2. **Configure step** - Set agent count (default 2000), optionally customize demographic distribution.
3. **Question step** - User types their question (e.g. "How does pricing for this product affect purchase decisions?").
4. **Launch** - Creates the simulation record, triggers the edge function.

New pages/components:
- `/simulation/new` - multi-step creation wizard
- `/simulation/:id` - simulation detail/results page

### Phase 3: Edge Functions - The AI Engine (do third)

Two edge functions using Lovable AI gateway:

**`process-materials`** - Receives uploaded file content and text, uses AI to extract key product/context information into a structured summary.

**`run-simulation`** - The core engine:
1. Takes the processed material summary + user question
2. Generates 2000 persona profiles (batched - AI generates groups of 50 at a time)
3. For each batch of personas, asks the AI to simulate their response to the question given the context
4. Stores each agent's response
5. After all agents respond, generates a final aggregated report with statistics, sentiment breakdown, and actionable insights
6. Updates simulation status at each stage so the frontend can show progress

### Phase 4: Live Progress & Results UI (do fourth)

- **Progress view** - Real-time status updates using Supabase realtime subscriptions on the `simulations` table. Shows current phase, agents processed count, progress bar.
- **Results view** - The final report rendered as a rich page with:
  - Executive summary
  - Key statistics (% positive, negative, neutral)
  - Demographic breakdown charts
  - Individual agent response samples
  - Full detailed report

### Implementation Order

We'll build this across multiple messages:

1. **Message 1**: Database migration (all tables + storage bucket) + simulation creation UI (upload, configure, question steps)
2. **Message 2**: Edge functions for material processing and simulation engine
3. **Message 3**: Live progress tracking + results/report page
4. **Message 4**: Polish, error handling, credit deduction

### Technical Details

- Edge functions use Lovable AI gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`) with `google/gemini-3-flash-preview` model (cost-efficient, fast)
- Personas are generated in batches of 50 via structured output (tool calling) to keep responses parseable
- Simulation progress tracked by updating `simulations.status` column, frontend subscribes via Supabase realtime
- PDFs parsed on the edge function side using the document content
- Files uploaded to Supabase Storage via the JS client, then the edge function reads them
- Each simulation costs 1 credit, deducted from `profiles.credits_remaining`

