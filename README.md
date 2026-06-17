# durable-memory (slice) — proof for archestra#3837

Minimal, review-first, scope-isolated agent memory. One additive table, three tools, one prompt hook. No new infra, no config UI. Built small on purpose after reading the closed #4198 (146 files) — the lesson there is additive, not sprawling.

## Two decisions that matter
- **Review-first.** A conversation *proposes* memory; nothing is recalled into a prompt until a human approves it. Unreviewed content never reaches a model.
- **Hard scope isolation.** `user` / `team` / `org`. `recall` returns only what the requester is entitled to. No cross-user or cross-team leakage (the Lethal-Trifecta posture).

## Shape
Table `memories(org_id, scope ∈ user|team|org, scope_id, content, status ∈ pending|approved|rejected, source_conversation_id, created_by, created_at)`, plus `memory_save` (propose) / `memory_recall` (approved + entitled) / `memory_delete`, and `buildMemoryContext()` injected at prompt-construction time. Full SQL is at the top of `memory_demo.ts`.

## Run
```bash
node --experimental-strip-types memory_demo.ts
