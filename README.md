# RabbitHole 🕳️🐇
### Click anything. Investigate everything. Follow the evidence.

RabbitHole is an autonomous, evidence-grounded company and market intelligence platform. Unlike standard AI research tools that hallucinate connections or summarize ungrounded claims, RabbitHole transforms companies, products, competitors, and leadership networks into an **immutable, interactive knowledge graph** where **every single fact traces back to an exact verbatim quote, character offset, and verified source URL**.

---

## 🌟 Key Capabilities

- **Zero-Hallucination Knowledge Graphs:** Every entity relationship (e.g. `OFFERS_PRODUCT`, `COMPETES_WITH`, `LED_BY`, `RAISED`) is backed by a primary evidence quote. Unsupported claims are discarded.
- **Strict Verbatim Quote Verification (`verify.ts`):** Before an extracted relationship is committed to the graph, RabbitHole searches the raw page HTML/text for the exact substring. If an LLM fabricates or tweaks the quote, the claim is rejected.
- **Source Trust Tiering & Review Queue:**
  - *Tier 1 (First-Party & Verified News):* High trust, auto-committed (`SOURCE_SUPPORTED`).
  - *Tier 2 (Corroborated):* Claims supported by two or more independent root domains become `CORROBORATED`.
  - *Tier 3 (Social / Low-Trust):* Social media posts, forum discussions, and job boards route to a human-in-the-loop **Review Queue** for explicit approval.
- **Live Ground-Truth Re-verification:** Click *Re-check sources* anytime. RabbitHole re-crawls the live web via TinyFish. If a page was deleted or the quote removed, the claim is automatically flagged as `OUTDATED`.
- **Conflict Detection:** Identifies conflicting facts (e.g. differing founding dates or mismatched headquarters) across multiple sources and flags the dispute directly on the graph edge.
- **Deep Document Ingestion:** Upload `.pdf`, `.txt`, or `.md` files (such as 10-Ks, pitch decks, whitepapers). Clean text extraction via `unpdf` is hashed (`sha256`) and treated as primary ground-truth evidence (`doc:<hash>`).
- **Autonomous Web & Agent Scraping:** Powered by **TinyFish** (Search, Fetch, and Headless Browser Agent) to crawl modern dynamic, JS-heavy web apps and behind-login contexts.
- **Ask the Graph (Strict Grounded Q&A):** Chat with your investigation. The Q&A engine only answers using numbered nodes and edges existing in your graph, providing full citation numbers.
- **Scheduled Automated Monitoring:** Continuous periodic updates (every 6 hours, 12 hours, daily, or weekly) with instant Slack webhook notifications on newly discovered relations or market changes.
- **Executive Dossier Export:** Generate print-ready HTML due-diligence reports or clean Markdown (`.md`) files with complete evidence bibliographies and confidence scores.

---

## 🏗️ Technical Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Next.js 16 + React 19                         │
│   Landing Page (Aceternity UI) │ Interactive Canvas (react-force-graph) │
│       Inspector Panel │ Sources & Review Queues │ Ask the Graph        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / SSE Stream
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Next.js App Router (Node.js 22+)                    │
│                                                                        │
│  ┌───────────────────────┐   ┌──────────────────────────────────────┐  │
│  │   Pipeline Worker     │   │         Verification Engine          │  │
│  │ • Bounded Depth Runs  │   │ • Substring Exact Match (locate)     │  │
│  │ • SSE Event Streaming │   │ • Domain Independence Scoring        │  │
│  │ • Background Queue    │   │ • Source Tiering (Social / News)     │  │
│  └───────────┬───────────┘   └──────────────────┬───────────────────┘  │
│              │                                  │                      │
│  ┌───────────▼──────────────────────────────────▼───────────────────┐  │
│  │                 Native SQLite (`node:sqlite`)                    │  │
│  │ • Single synchronous connection (WAL mode)                       │  │
│  │ • Dynamic Postgres-style parameter mapping ($1 -> ?)             │  │
│  │ • Atomic transactions (tx) & automatic JSON serialization        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │                                 │
         ┌─────────▼────────┐              ┌─────────▼────────┐
         │  TinyFish APIs   │              │   Groq LLM Pool  │
         │ • Fast Web Search│              │ • JSON Mode      │
         │ • Web Fetch      │              │ • Key Rotation   │
         │ • Browser Agent  │              │ • Zod Extraction │
         └──────────────────┘              └──────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `v22.5.0` or higher (RabbitHole uses the native built-in `node:sqlite` module, requiring Node 22.5+).
- **npm**: `v10+`

### 1. Clone the Repository

```bash
git clone https://github.com/Karthikeyan1508/rabbit-hole.git
cd rabbit-hole
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the project root (see `.env.example`):

```bash
cp .env.example .env
```

Set the following keys:

```env
# Database Path (defaults to rabbit-hole.db in local directory)
DATABASE_PATH=rabbit-hole.db

# TinyFish API Key (for web search, page fetching, and browser agent)
TINYFISH_API_KEY=sk-tinyfish-...

# Groq API Keys (comma-separated for automatic round-robin & rate-limit rotation)
GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3

# LLM Model (default: openai/gpt-oss-120b or llama-3.3-70b-versatile)
LLM_MODEL=openai/gpt-oss-120b
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Running Tests

Run the test suite covering quote verification, PDF text extraction, domain safety, and key rotation:

```bash
npm test
```

---

## 📦 Production Deployment (Render)

RabbitHole is pre-configured for one-click deployment on [Render](https://render.com) as a Web Service.

### Render Settings
- **Runtime:** `Node`
- **Node Version:** `22.13.0` (set via `NODE_VERSION=22.13.0` in Environment Variables)
- **Build Command:**
  ```bash
  npm ci --include=dev && npm run build
  ```
- **Start Command:**
  ```bash
  npm start
  ```
- **Environment Variables:**
  - `NODE_ENV=production`
  - `NODE_VERSION=22.13.0`
  - `DATABASE_PATH=/opt/render/project/src/rabbit-hole.db`
  - `TINYFISH_API_KEY=<your-key>`
  - `GROQ_API_KEYS=<your-keys>`
  - `LLM_MODEL=openai/gpt-oss-120b`

---

## 🧩 Core Implementation Details

| Module | Location | Purpose |
| :--- | :--- | :--- |
| **Database Engine** | [`src/lib/db.ts`](src/lib/db.ts) | Built-in SQLite via `DatabaseSync`. WAL mode with 5s timeout. Postgres `$1` parameter normalization. |
| **Worker & Pipeline** | [`src/lib/worker.ts`](src/lib/worker.ts) | Autonomous multi-stage pipeline: Planning ➔ Search ➔ Fetch ➔ Extract ➔ Verify ➔ Commit. |
| **Quote Verifier** | [`src/lib/verify.ts`](src/lib/verify.ts) | Normalizes text and locates exact substrings to eliminate hallucinations. |
| **TinyFish Client** | [`src/lib/tinyfish.ts`](src/lib/tinyfish.ts) | Direct wrapper for TinyFish Search, Fetch, and headless Agent endpoints. |
| **Key Rotation** | [`src/lib/keyring.ts`](src/lib/keyring.ts) | Fault-tolerant Groq API key manager with cooldowns on 429 rate limits. |
| **Monitoring Engine** | [`src/lib/watch.ts`](src/lib/watch.ts) | Cron/interval checker triggering periodic updates and Slack webhook alerts. |
| **Document Ingestion** | [`src/lib/pdftext.ts`](src/lib/pdftext.ts) | Robust PDF text extraction via `unpdf` without external binary dependencies. |
| **Interactive Graph** | [`src/components/Workspace.tsx`](src/components/Workspace.tsx) | Force-directed graph canvas, live evidence inspector, and filter controls. |

---

## 🔒 Security & Guardrails

- **SSRF Protection (`urlguard.ts`):** Restricts fetching to valid public HTTP/HTTPS URLs. Blocks loopback (`127.0.0.1`, `localhost`), cloud metadata IP addresses (`169.254.169.254`), and private internal network subnets.
- **Content Security & Input Validation:** Strict request payloads validated at all `/api/v1/*` endpoints using **Zod** schemas.
- **No Secret Leakage:** `.env` and local database binaries are strictly ignored in `.gitignore`. GitHub push protection guards credentials.

---

## 📄 License

This project is licensed under the MIT License.
