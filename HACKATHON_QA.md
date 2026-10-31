# RabbitHole: technical and product Q&A prep

This guide reflects the current code on October 31, 2026. The current production build passes, TypeScript passes, and 10 unit tests pass.

## 1. Thirty-second technical explanation

> RabbitHole turns a selected entity, claim, or relationship into a bounded research job. TinyFish Search discovers pages, Fetch reads normal pages, and TinyFish Agent handles interactive sites. Groq extracts structured claims. A claim enters the graph only when its quoted text can be located in the saved source snapshot and a second semantic check confirms that the excerpt supports the claim. Every accepted edge points to a claim, evidence excerpt, source, snapshot hash, and retrieval time. Jobs persist events before streaming them to the browser, so progress can replay after reconnects.

## 2. Architecture in one view

```text
React workspace
  | POST expansion
  v
Next.js API -> SQLite expansion_jobs
  | starts bounded in-process worker
  v
Plan -> TinyFish Search -> source ranking -> TinyFish Fetch
                                      \-> TinyFish Agent when requested/needed
  v
Groq structured extraction (Zod validated)
  v
Exact quote location in saved snapshot
  v
Groq semantic support judgment
  v
Trust gate / review queue / conflict check
  v
Single SQLite transaction -> nodes + claims + evidence + edges
  v
Persisted events -> SSE -> graph and activity UI
```

## 3. Technical implementation

### Front end

- Next.js 16 App Router, React 19, TypeScript.
- `react-force-graph-2d` draws the graph on canvas. It loads dynamically with SSR disabled because it depends on browser canvas APIs.
- The workspace has three main areas: investigation navigation, graph, and evidence/context. The bottom panel renders persisted job activity.
- `EventSource` connects to the expansion SSE endpoint. The browser automatically sends `Last-Event-ID` after a reconnect.
- Incremental graph reads use `GET /graph?sinceVersion=N`. Only newer nodes and edges return.
- Familjen Grotesk is used throughout. Aceternity-style components supply motion and interaction, but core controls are local reusable components.

### Job creation

- `POST /api/v1/investigations/:id/expansions` validates the target and config with Zod.
- The target must belong to the investigation.
- An `Idempotency-Key` returns the existing job when the same request is retried.
- Only one active expansion per investigation is allowed. Another returns HTTP 409.
- A job stores its mode, source limit, agent limit, depth, domain restrictions, and time budget.

### Pipeline

1. **Planning:** Groq receives target context, existing relationships/evidence, the user question, and prior queries. It returns three queries in quick mode or five in deep mode.
2. **Discovery:** TinyFish Search returns candidates. URLs are validated, canonicalized, and deduplicated.
3. **Ranking:** first-party, official, news, directory, generic web, jobs, and social pages receive heuristic trust scores. The highest-scoring pages consume the limited source budget first.
4. **Reading:** TinyFish Fetch reads up to ten URLs per batch. Per-URL errors are recorded without stopping the job.
5. **Browser agent:** when the user requests it, or normal fetch yields nothing, TinyFish Agent navigates the site. Its run ID and live streaming URL are emitted to the UI. Returned nested JSON is unwrapped into plain passages before verification.
6. **Extraction:** Groq returns subject, type, predicate, object, object type, verbatim quote, and optional date range. Zod rejects malformed output.
7. **Quote check:** the quote must be found in the normalized saved source snapshot. Missing or fabricated quotes are rejected immediately.
8. **Semantic check:** a second model call labels the excerpt `supported`, `contradicted`, or `insufficient`. A lexical match alone is not accepted.
9. **Trust gate:** support from only low-trust sources goes to the review queue instead of the graph.
10. **Commit:** accepted nodes, claims, evidence, and edges are written in one transaction. The graph version increments.
11. **Wrap-up:** the job stores metrics, unresolved questions, and suggested next questions. Budget exhaustion returns `PARTIAL`, preserving verified work.

### Evidence model

The auditable path is:

```text
graph edge -> claim -> claim_evidence -> source -> saved snapshot
```

Evidence stores the excerpt, offsets, verdict, verification method, and snapshot hash. The UI never relies on an unauditable JSON-only edge.

### Verification guarantees

RabbitHole guarantees:

- the source was retrieved;
- the displayed quote existed in the stored text;
- an automated semantic check judged that quote supportive;
- the edge can be traced back to evidence.

RabbitHole does **not** guarantee objective truth. A real page can still be wrong. The precise claim is: “this source supports this statement.”

### Source confidence

- First-party page: roughly 0.95.
- Uploaded document: 0.9.
- Government/education: 0.85.
- News: 0.7.
- Business directory: 0.6.
- Generic web: 0.5.
- Jobs: 0.25.
- Social: 0.2.
- Two supporting hostnames add a corroboration bonus.

These are explainable heuristics, not learned truth scores. Hostname diversity only approximates source independence.

### Contradictions

- Contradiction checks currently target single-valued plain attributes, such as founding year or CEO.
- Claims with date ranges are excluded so normal historical changes are not mislabeled.
- Conflicting claims remain stored. RabbitHole does not silently delete either side.
- Complex semantic resolution remains future work.

### Persistence

- Node's built-in `node:sqlite` provides one SQLite connection.
- WAL mode, foreign keys, and a five-second busy timeout are enabled.
- Tables cover investigations, nodes, edges, claims, sources, evidence, jobs, events, discoveries, review items, and conflicts.
- A lightweight helper accepts Postgres-style `$1` placeholders and parses known JSON columns.
- SQLite is suitable for the single-machine hackathon demo. Production should move to Postgres and real migrations.

### Real-time reliability

- Every event is inserted into `expansion_events` before the UI receives it.
- Each event has a monotonic per-job sequence number.
- SSE replays rows after `Last-Event-ID`, then polls the event table until the job is terminal.
- Cancellation is cooperative. Stage checkpoints read `cancel_requested`; active TinyFish agent runs are cancelled through TinyFish.
- If the server restarts, persisted state survives, but in-process execution does not. An orphaned active job is marked failed.

### TinyFish integration

- Search: finds relevant URLs.
- Fetch: reads normal pages as Markdown in batches of ten.
- Agent: operates interactive pages, emits progress, and provides a live browser stream.
- Fetch is cheaper and simpler, so it is preferred. Agent use is explicit or fallback.
- Agent output goes through the same quote and semantic checks as fetched pages.

### Groq and model behavior

- Groq's OpenAI-compatible endpoint runs `openai/gpt-oss-120b` by default.
- `openai/gpt-oss-20b` is the fallback model.
- Temperature is zero and JSON mode is enabled.
- Every model response is validated with Zod.
- Several Groq keys can rotate after authentication or rate-limit errors.
- The verifier currently uses the same provider/model family as extraction. Production could use an independent verifier or entailment model to reduce correlated errors.

### Documents and PDFs

- Pasted text, `.txt`, `.md`, and PDF files enter the same source/evidence pipeline.
- PDFs are limited to 10 MB.
- `unpdf` extracts selectable text. Image-only PDFs are rejected because OCR is not implemented.
- Extracted text is normalized and capped at 60,000 characters.
- Important privacy limit: uploaded text is sent to Groq for extraction and verification. Do not claim confidential-document isolation in this prototype.

### Ask the graph

- The newest 80 verified claims, excerpts, and source hosts form the prompt.
- The model may answer only from those numbered facts.
- Returned citation numbers are mapped back to stored claims. Invalid citation numbers are dropped.
- Larger production graphs need retrieval over claims instead of a hard newest-80 window.

### Monitoring

- Next.js instrumentation starts an in-process timer.
- Every minute it checks whether a 6-hour, daily, or weekly investigation is due.
- A due check re-investigates the root entity for recent changes.
- Slack-compatible webhook alerts are sent only when new relations or conflicts appear.
- Server downtime pauses monitoring. Production needs cron or a durable queue.

### API-key rotation

- Comma-separated `GROQ_API_KEYS` and `TINYFISH_API_KEYS` are supported.
- A key receiving 401/402/403/429 enters a cooldown and the next key is tried.
- TinyFish agent polling and cancellation reuse the same key that started the run.
- This improves demo reliability. It is not a substitute for provider-compliant quotas and billing.

### Security

- Secrets stay server-side.
- URL validation blocks localhost, common private IPv4 ranges, IPv6 loopback/private ranges, and non-HTTP protocols.
- Redirect destinations are validated again after fetch.
- Source text appears only as tagged untrusted user data in model prompts.
- The agent is instructed to read only and avoid login, purchase, and personal-data submission.
- Known limitation: URL checks do not perform DNS resolution, so DNS rebinding is not fully covered. TinyFish performs the actual web fetch remotely, which reduces local-network exposure.
- No authentication or per-user authorization exists. This is a single-user prototype.

## 4. Technical questions judges may ask

### “How do you prevent hallucinated citations?”

> The model must provide a verbatim quote. I locate that quote in the source snapshot saved by the application. If it is absent, the claim is rejected before graph insertion. Then a separate semantic judgment checks whether the excerpt actually supports the normalized claim.

### “Is the semantic verifier another model?”

> It is another structured model call, currently through the same Groq model family. Exact quote location is deterministic; semantic entailment is automated. For production I would use a separate verifier model and human review for high-impact claims.

### “Why a graph instead of a report or chat?”

> A graph preserves reusable entities, typed relationships, investigation branches, and evidence per relationship. Any node or edge becomes the target of the next investigation. A static report cannot preserve that recursive structure cleanly.

### “Why TinyFish Search, Fetch, and Agent?”

> They solve different cost levels. Search discovers. Fetch reads ordinary pages cheaply. Agent operates interactive sites. The system escalates to the agent only when requested or needed, then verifies its output exactly like any fetched page.

### “What happens when one source fails?”

> The failure becomes a persisted event. Other pages continue. The final summary lists blocked sources. One bad URL never corrupts or aborts the graph commit.

### “What happens when the run exceeds its budget?”

> The job becomes `PARTIAL`. Only claims already verified and committed remain. RabbitHole does not invent completion percentages or add unverified leftovers.

### “How does reconnect work?”

> Events are rows in SQLite before they are streamed. EventSource reconnects with `Last-Event-ID`. The SSE route replays only later sequence numbers, then resumes live tailing.

### “How do you avoid duplicate entities?”

> Nodes have an investigation-scoped canonical key plus type. Merge operations save the old key as an alias. Future upserts match either the canonical key or an alias.

### “How do transactions work?”

> The graph version, nodes, claims, evidence, edges, and discoveries commit inside one SQLite transaction. A failure rolls back the whole graph update.

### “How do you scale this?”

> Replace the in-process runner with a durable queue, move SQLite to Postgres, add worker concurrency with per-provider limits, and add authentication and tenancy. The persisted job/event contracts already separate the UI from execution.

### “Why not Neo4j?”

> The graph is small and evidence provenance is relational. SQL foreign keys and transactions are more valuable than graph-query infrastructure for the MVP. Neo4j becomes useful only when cross-investigation graph traversal dominates.

### “Why no ORM?”

> The schema is small, SQL is explicit, and Node includes SQLite. An ORM adds surface area without solving a hackathon problem. Production migrations are the missing piece, not object mapping.

### “Why SSE instead of WebSockets?”

> Progress is one-way server to browser. SSE provides event names, built-in reconnect, and `Last-Event-ID` with less code. Cancellation remains a normal POST request.

### “How does the live browser fit the trust model?”

> The agent is only a content-acquisition tool. Its passages become a stored source and still require exact quote location plus semantic support. Agent completion alone never creates an edge.

### “How do PDFs work?”

> The API verifies the PDF signature, enforces 10 MB, extracts selectable text with `unpdf`, rejects image-only files, normalizes the text, stores it as a source, then runs the standard extraction and verification pipeline.

### “What tests do you have?”

> Ten unit tests cover quote location, URL safety/canonicalization, source quality/confidence, monitor due logic, key rotation, agent-result unwrapping, and PDF extraction. The current TypeScript check and production Next.js build both pass. Live development checks covered idempotency, cancellation, SSE replay, review, merge, source re-check, PDF upload, and the TinyFish browser agent.

## 5. Codebase questions judges or engineers may ask

### “Where does an investigation start?”

> The expansion API calls `createExpansion` in `src/lib/worker.ts`. It validates target ownership, enforces idempotency and one-active-run, stores the job, emits the first event, and starts `runJob`.

### “Where is the core logic?”

> `src/lib/worker.ts`. `runJob` owns planning through verification. `agentRead` owns TinyFish Agent polling. `commit` performs the transaction. `autoExpand` chains depth-limited follow-ups. `acceptReview` promotes a reviewed claim.

### “Where is provider code isolated?”

> `src/lib/tinyfish.ts` wraps Search, Fetch, Agent, polling, cancellation, and TinyFish key rotation. `src/lib/llm.ts` wraps Groq, JSON mode, schema validation, retries, model fallback, and Groq key rotation.

### “Where is deterministic verification?”

> `src/lib/verify.ts`. It normalizes whitespace, hashes snapshots, creates canonical entity keys, locates quotes, and counts distinct hostnames.

### “Where is source quality decided?”

> `src/lib/quality.ts`. It maps URL patterns to source types and scores. This is intentionally explainable and replaceable.

### “Where is real-time streaming?”

> `src/app/api/v1/expansions/[id]/events/route.ts`. It reads persisted events after `Last-Event-ID`, sends SSE frames, writes keepalives, and closes only after the terminal job is drained.

### “Where is graph rendering?”

> `src/components/Workspace.tsx`. It owns selection, incremental graph merging, filters, EventSource attachment, the TinyFish live iframe, and `react-force-graph-2d` drawing callbacks.

### “Why is the database helper unusual?”

> `src/lib/db.ts` uses synchronous `node:sqlite` behind async-looking helpers. It translates `$1` placeholders to SQLite positional parameters and JSON-parses known columns. This kept the earlier API SQL readable while avoiding another dependency.

### “How are old sources preserved in the UI?”

> The sources endpoint rebuilds the full source list from all persisted events across all runs. Live events are layered on top, so starting a PDF run does not erase web sources from earlier runs.

### “What does `agentText` solve?”

> TinyFish Agent may return an object, a JSON string, or JSON wrapped in `result`. `agentText` recursively unwraps these shapes into plain passages so quote offsets can match.

### “What shortcuts are explicitly documented?”

> In-process jobs and bulk queue, hostname-based independence, heuristic source reputation, newest-80 Ask-the-graph context, schema bootstrapping without migrations, no OCR, and URL validation without DNS resolution.

## 6. Product questions judges may ask

### “Who is the first customer?”

> Analysts who repeatedly verify public-company claims: venture, procurement, competitive intelligence, and investigative research. The first wedge is small teams doing due diligence without enterprise research-platform budgets.

### “What painful job are you replacing?”

> Opening many tabs, copying claims into notes, losing provenance, repeating searches, and manually checking whether a later source contradicts an earlier one.

### “Why is this better than Perplexity or normal deep research?”

> The output is not a disposable report. Every relationship is a persistent, clickable object with evidence, status, history, and a next investigation action. RabbitHole also exposes rejected claims and conflicts instead of hiding them.

### “What is the moat?”

> Not the graph visualization. The moat is the accumulating evidence graph: claim-level provenance, review decisions, aliases, historical changes, rejected candidates, and monitoring history. That dataset improves entity resolution and source quality over time.

### “How would you charge?”

> B2B SaaS: seat fee plus usage for research runs, browser-agent minutes, and monitoring. Enterprise adds retention controls, private deployment, SSO, audit export, and approved-source policies.

### “What is your north-star metric?”

> Useful source-supported findings per investigation. Secondary metrics: unsupported-claim escape rate, time to first useful evidence, duplicate-entity rate, cost per accepted finding, and repeat investigations per user.

### “Why will users return?”

> Monitoring and graph continuity. A one-off report competes with search. A living evidence graph becomes the user's research memory and alerts them when facts change.

### “What is the biggest trust risk?”

> A real source can be wrong or biased. RabbitHole preserves attribution and conflict; it does not claim to establish objective truth. High-impact decisions still require human review.

### “What is the biggest technical risk?”

> Model recall and entity resolution. The quote gate protects precision, but a weak or rate-limited model can miss facts. Better retrieval, dedicated entity resolution, and an independent verifier improve recall without weakening trust.

### “What is the privacy story?”

> Current web research is public-only. Uploaded documents are stored locally but their text is sent to Groq for analysis. Production needs authentication, tenant isolation, retention settings, encryption, and a private-model option before handling confidential files.

### “What would you build next?”

> First: durable workers, Postgres, authentication, and shareable read-only investigations. Then: historical source snapshots, stronger source-independence detection, OCR, collaboration, and monitoring at scale.

### “Why does this deserve to win?”

> It demonstrates TinyFish across Search, Fetch, and a visible live Agent. More importantly, it turns agent output into auditable product behavior: exact evidence, rejected findings, bounded execution, replayable history, and a graph that can be investigated again.

## 7. Questions you should ask yourself before the demo

- Can I explain the difference between source support and objective truth in one sentence?
- Can I point from one edge to its exact quote and original URL?
- Can I show one rejected claim and explain why it failed?
- Can I explain why Fetch is preferred and Agent is escalation?
- Can I say which parts survive a server restart and which do not?
- Can I name one production scaling change without pretending it already exists?
- Can I show a finished backup investigation if the live web stalls?

## 8. Claims safe to make on stage

- Current production build passes.
- TypeScript passes.
- 10 unit tests pass.
- TinyFish Search, Fetch, and Agent are all integrated.
- A real Agent run completed and 4 of 4 returned product findings passed verification in one development run.
- Idempotency, cancellation, and SSE replay were tested live during development.
- PDF text extraction and invalid-PDF rejection are tested.

Do not claim:

- objective truth;
- production-scale durability;
- confidential PDF isolation;
- full SSRF protection;
- true publisher independence;
- multi-user security;
- OCR support.
