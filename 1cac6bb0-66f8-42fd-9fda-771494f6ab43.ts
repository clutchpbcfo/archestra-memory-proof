/**
 * Durable agent memory — minimal, review-first, scope-isolated slice.
 * Standalone proof for archestra-ai/archestra#3837. In-memory here for a
 * dependency-free demo; the production shape is the SQL below (one additive table).
 *
 * Two decisions that matter:
 *   1. Review-first: a conversation PROPOSES memory; nothing is recalled into a
 *      prompt until a human approves it. Unreviewed content never reaches a model.
 *   2. Hard scope isolation: user / team / org. Recall only returns memories the
 *      requester is actually entitled to. No cross-user or cross-team leakage.
 *
 * Production table (additive migration, nothing else changes):
 *   CREATE TABLE memories (
 *     id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     org_id               uuid NOT NULL,
 *     scope                text NOT NULL CHECK (scope IN ('user','team','org')),
 *     scope_id             text NOT NULL,            -- user_id / team_id / org_id
 *     content              text NOT NULL,
 *     status               text NOT NULL DEFAULT 'pending'
 *                            CHECK (status IN ('pending','approved','rejected')),
 *     source_conversation_id uuid,                   -- provenance
 *     created_by           uuid NOT NULL,
 *     created_at           timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX ON memories (org_id, scope, scope_id, status);
 */

type Scope = "user" | "team" | "org";
type Status = "pending" | "approved" | "rejected";

interface Memory {
  id: string;
  orgId: string;
  scope: Scope;
  scopeId: string;
  content: string;
  status: Status;
  sourceConversationId?: string;
  createdBy: string;
  createdAt: Date;
}

/** Who is asking — used to compute what they're entitled to recall. */
interface Requester {
  orgId: string;
  userId: string;
  teamIds: string[];
}

let _seq = 0;
const uid = (p: string) => `${p}_${++_seq}`;

class MemoryStore {
  private rows: Memory[] = [];

  /** memory_save — PROPOSE a candidate. Never auto-approved. */
  save(input: {
    orgId: string; scope: Scope; scopeId: string; content: string;
    createdBy: string; sourceConversationId?: string;
  }): Memory {
    const m: Memory = { id: uid("mem"), status: "pending", createdAt: new Date(), ...input };
    this.rows.push(m);
    return m;
  }

  /** Human-in-the-loop: a reviewer approves (or rejects) a candidate. */
  review(id: string, decision: "approved" | "rejected"): void {
    const m = this.rows.find((r) => r.id === id);
    if (m) m.status = decision;
  }

  /** memory_delete — soft semantics (drop from recall). */
  delete(id: string): void {
    this.rows = this.rows.filter((r) => r.id !== id);
  }

  /**
   * memory_recall — the entitlement check. Returns ONLY approved memories the
   * requester can see: their own user memories, their teams' memories, and org
   * memories. Anything else is invisible.
   */
  recall(req: Requester): Memory[] {
    return this.rows.filter((m) => {
      if (m.orgId !== req.orgId || m.status !== "approved") return false;
      if (m.scope === "org") return true;
      if (m.scope === "user") return m.scopeId === req.userId;
      if (m.scope === "team") return req.teamIds.includes(m.scopeId);
      return false;
    });
  }
}

/** Prompt-construction hook: build the context block injected at request time. */
function buildMemoryContext(store: MemoryStore, req: Requester): string {
  const mems = store.recall(req);
  if (mems.length === 0) return "";
  const lines = mems.map((m) => `- (${m.scope}) ${m.content}`);
  return ["## Remembered context", ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Demo scenario
// ---------------------------------------------------------------------------
const store = new MemoryStore();
const ORG = "acme";
const alice: Requester = { orgId: ORG, userId: "alice", teamIds: ["eng"] };
const bob: Requester   = { orgId: ORG, userId: "bob",   teamIds: ["eng"] };
const carol: Requester = { orgId: ORG, userId: "carol", teamIds: ["sales"] };

const show = (label: string, req: Requester) => {
  const ctx = buildMemoryContext(store, req);
  console.log(`\n[recall for ${req.userId}]\n${ctx || "(no memory injected)"}`);
};

console.log("1) Alice's chat proposes a memory (review-first → pending, NOT yet usable)");
const cand = store.save({
  orgId: ORG, scope: "user", scopeId: "alice", createdBy: "alice",
  content: "Prefers TypeScript; avoid Friday-afternoon deploys.",
  sourceConversationId: "conv_42",
});
show("before approval", alice); // empty — pending is never injected

console.log("\n2) A human approves the candidate");
store.review(cand.id, "approved");
show("new session, after approval", alice); // now present

console.log("\n3) Scope isolation: Bob (same org) must NOT see Alice's user memory");
show("bob", bob); // empty — user-scoped to alice

console.log("\n4) Team + org memories (approved)");
store.review(store.save({ orgId: ORG, scope: "team", scopeId: "eng", createdBy: "lead", content: "Eng uses trunk-based dev." }).id, "approved");
store.review(store.save({ orgId: ORG, scope: "org", scopeId: ORG, createdBy: "admin", content: "Fiscal year ends June 30." }).id, "approved");
show("alice (eng)", alice);   // user + team(eng) + org
show("bob (eng)", bob);       // team(eng) + org, but NOT alice's user memory
show("carol (sales)", carol); // org only — not eng's team memory

console.log("\n5) Delete removes it from recall");
store.delete(cand.id);
show("alice after delete of her pref", alice);
console.log("\nDONE.");
