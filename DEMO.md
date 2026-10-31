# RabbitHole — Live Hackathon Demo Guide

## Overview
RabbitHole turns any company, claim, or relationship into an immutable, evidence-backed investigation graph. Every graph edge traces to an exact verbatim quote, verified source URL, and character offset.

---

## 1. Three-Minute Live Demo Script

| Time | Action | Voice Track / Talking Points |
| :--- | :--- | :--- |
| **0:00 - 0:30** | Open Landing (`http://localhost:3030`). Type **Stripe** or click chip. | *"Most AI research tools hallucinate relationships. RabbitHole turns any company into a verified knowledge graph where every edge is grounded in primary evidence."* |
| **0:30 - 1:15** | View Workspace. Click **Investigate Deeper**. Select **Explore products**. Click Run. | *"Watch the bottom activity panel: it plans queries, searches TinyFish, fetches snapshots, extracts candidate claims, and runs strict quote verification. Fabricated quotes are rejected."* |
| **1:15 - 2:00** | Click an edge on the graph. Open right-hand **Inspector**. | *"When I click this edge, you see the exact verbatim quote, the source publisher, and verification confidence. One source gives `SOURCE_SUPPORTED`; two independent domains give `CORROBORATED`."* |
| **2:00 - 2:30** | Switch to **Sources** tab. Toggle **Live Browser Agent** or upload a PDF. | *"We handle PDFs with `unpdf` and live web navigation via TinyFish Agent. Notice the live iframe stream showing the agent browsing."* |
| **2:30 - 3:00** | Click **Ask the Graph** box. Ask *"What products does TinyFish offer?"*. | *"The Ask engine answers strictly from the numbered facts on the graph with real citations. Unsupported questions are refused."* |

---

## 2. Five-Minute Extended Demo Script

- **0:00 - 1:00**: Problem statement & landing page UX with Aceternity motion (FlipWords, Spotlight, BackgroundBeams).
- **1:00 - 2:00**: Live graph exploration, force-graph controls, type legend filtering (Company blue, Product navy, Person amber), and conflict detection.
- **2:00 - 3:15**: Bounded pipeline execution: live SSE streaming events, quote locator verification, and review queue for low-trust sources.
- **3:15 - 4:15**: Document ingestion (`.pdf`, `.txt`, `.md`) with sha256 `doc:<hash>` provenance and TinyFish browser automation.
- **4:15 - 5:00**: Report generation (HTML print-ready & Markdown download) and recurring monitoring with webhook notifications.

---

## 3. Fallback Plan (Network / Provider Slowdown)
- **Backup Investigation Available**: Pre-seeded backup investigation **`TinyFish`** (ID: `00000000-0000-4000-8000-000000000001`).
- Has verified products (`TinyFish Agent`), competitors (`Browserbase`), and citations.
- If live web calls are throttled, immediately open **TinyFish** from the recent investigations list to demonstrate the full interactive graph, inspector, evidence quotes, and Ask-the-graph Q&A with zero latency.

---

## 4. Architecture Summary
- **Runtime**: Next.js 16 App Router, React 19, TypeScript strict mode.
- **Database**: Single `node:sqlite` connection in WAL mode with 5-second busy timeout and atomic transactions.
- **Styling**: Tailwind CSS 4, Familjen Grotesk, 4-color palette (`#ffffff`, `#14213d`, `#2457d6`, `#d97706`).
- **Graph**: `react-force-graph-2d` with custom canvas rendering.
- **Integrations**: Groq (JSON mode, temperature 0, Zod validated) with key rotation; TinyFish Search, Fetch, and Agent.

---

## 5. Honest Limitations
- Single-instance in-memory worker queue; background jobs execute on the local Node server process.
- PDF extraction relies on selectable text; scanned image-only PDFs require upstream OCR.
- Agent browser runs take 30–60 seconds to execute full navigation runs.

---

## 6. Likely Technical Questions
- **Q: How do you prevent hallucinations?**
  *A:* Verbatim substring localization. Every claim must have a quote matching the saved snapshot text exactly or via normalized whitespace. If the quote isn't in the snapshot, the claim is rejected.
- **Q: How does SQLite scale here?**
  *A:* WAL mode allows concurrent readers while writes execute in atomic immediate transactions with a 5000ms busy timeout.

---

## 7. Likely Product Questions
- **Q: Who uses this?**
  *A:* VC analysts, investigative journalists, compliance teams, and competitive intelligence researchers.
- **Q: Can it run on private intranets?**
  *A:* Yes, the document ingestion pipeline works entirely on local files without external search.
