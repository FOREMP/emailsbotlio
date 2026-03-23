

## Rebuilding MiroFish as a SaaS on Lovable

### What MiroFish Does (Summary)

MiroFish is an AI-powered prediction engine that:
1. Takes "seed materials" (documents, news articles, reports, stories)
2. Builds a knowledge graph of entities and relationships (GraphRAG)
3. Generates AI agents with distinct personas, memories, and behaviors
4. Runs multi-agent simulations where agents interact over multiple rounds
5. Produces a detailed prediction report from the simulation results
6. Lets users chat with individual agents or the report-generating agent

### Approach: Simplified AI Simulation

Since the original uses Python's OASIS framework (which can't run in Lovable), we'll rebuild the simulation logic using **Lovable AI edge functions**. Each "agent" will be an LLM prompt with a persona and memory context, and simulation rounds will be orchestrated via edge functions calling the AI gateway in sequence.

### Architecture

```text
┌─────────────────────────────────────────────┐
│  React Frontend (Lovable)                   │
│  - Landing/pricing page                     │
│  - Auth (signup/login)                      │
│  - Upload seed materials                    │
│  - Configure & launch simulations           │
│  - View simulation progress & results       │
│  - Chat with agents / report agent          │
│  - Billing/usage dashboard                  │
└