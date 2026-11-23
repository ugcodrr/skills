# Perf context for acme/api

An example of `.agents/perf-review.md`. Copy it there and replace every value with your project's. A finding's win is only as good as these numbers: the same N+1 query is worth a PR on a saturated database and nothing on an idle one. Date what you measured, and update it when production changes.

Keep hostnames, addresses and secrets out of this file if the repo is public.

## The machine

- API: 2 containers, 4 vCPU and 8 GB each, behind a load balancer.
- Postgres 16, a managed 4 vCPU instance. Redis 7 (one thread) for sessions and the job queue.
- The job workers share nodes with the API, so their CPU counts against it.

## Load (measured 2026-01-10)

| What | Rate |
|---|---|
| API requests | 40 a second on average, 120 at peak |
| `POST /orders` | 3 a second at peak |
| Background jobs | about 15,000 a day |
| Nightly export | once a day, about 2.1M rows |

- At peak the API runs at 35% CPU and Postgres at 60%, so throughput matters only for Postgres.
- p95 latency is 180 ms against a 250 ms target.
- Sizes: `orders` has 40M rows, an order response is about 8 KB, a price list about 2 MB.

## Hard limits

- Payments partner API: 25 requests a second per key, then 429s and a backoff. Never raise concurrency against it.
- Email provider: 10 sends a second.
- Postgres: 100 connections in all, 20 per container pool.

## Hot paths

1. `POST /orders` (`src/routes/orders.ts`): auth, validate, price (`src/pricing/`), insert, then enqueue the receipt job.
2. `GET /orders/:id`: auth, cache lookup, Postgres on a miss.
3. Receipt job (`src/jobs/receipt.ts`): render the PDF, then email it.
4. Nightly export (`bin/export.ts`): reads the whole `orders` table, so look for whole-table loads and unbounded batches.

## Areas for reviewers

| Area | Paths |
|---|---|
| API | `src/routes`, `src/middleware`, `src/db` |
| Pricing | `src/pricing` |
| Jobs | `src/jobs`, `src/queue` |
| Scripts | `bin/` |

Out of scope unless asked: `web/` (separate team), `infra/`.

## Reference costs (measured here)

- A Postgres query by primary key: 0.8 ms.
- A partner API call: 120 ms p50.
- Rendering a receipt PDF: 45 ms of CPU.

## Already covered: report as "known", not new

| Finding | What | Status |
|---|---|---|
| P1 | Order list loads line items one order at a time | PR #123 |
| P2 | Price list parsed on every request | known, no PR (cached in #131, merged) |
| P3 | Export holds a transaction for the whole run | known, no PR: needs a design |

## Dismissed: don't re-raise without new evidence

- Logging overhead of the request logger (measured under 0.1 ms).
- Moving pricing to a worker thread (2 ms of CPU, under the floor).
