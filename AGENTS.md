# Agent Guidelines

## Commit Frequently
Commit working states as features/files are implemented.

## Tech Stack & Conventions
- Next.js 16 App Router
- React 19
- TypeScript strict
- Tailwind CSS 4
- Familjen Grotesk through `next/font/google`
- SQLite through Node's built-in `node:sqlite`
- Zod
- react-force-graph-2d
- motion
- clsx & tailwind-merge
- unpdf

## Product Philosophy
RabbitHole turns a company, claim, or relationship into an evidence-backed investigation graph. Every factual graph edge must eventually trace to a claim, evidence excerpt, source URL, and saved source text.

## Database & Models
- SQLite in WAL mode with foreign keys enabled and 5000ms busy timeout.
- Helper `q()` and `tx()` query runners.
- Postgres-style `$1`, `$2` parameter mapping to SQLite positional/named parameters.
- Automatic JSON serialization/deserialization for marked columns.

