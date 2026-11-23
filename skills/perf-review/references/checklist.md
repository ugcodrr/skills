# The perf checklist

Eleven questions. For each one, the review gives its findings, or "checked, clean" with the places it looked. A finding needs a file:line, the hot path it sits on, and an estimate (see "Sizing" at the end).

Examples are from Node, Python and Go. The shapes are the same in any runtime.

## What counts as a win

It depends on the project's context (`.agents/perf-review.md`): how loaded production is, which limit it hits first, and which paths are hot. Read that before you judge anything. A win is one of these:

- less latency on a request, command, page or job someone waits on;
- a shorter stall of whatever runs one thing at a time (an event loop, the GIL, a lock), which delays everything else waiting on it;
- less memory, or unbounded growth removed;
- fewer calls against a hard external limit (a rate-limited API, a paid quota);
- less load on a shared resource that's single-threaded or near capacity (Redis, a database primary, one queue worker);
- more throughput, but only when the context says the system runs near capacity. On a mostly idle machine, throughput alone isn't a win.

## 1. Is it sequential? Could it run concurrently?

- **Look for:** a blocking call or an await inside a loop over independent items. Back-to-back calls where the second doesn't use the first's result. Several database or cache calls that could be one round trip.
  - Node: `for (const id of ids) await load(id)`, or `await a(); await b();` where `Promise.all` fits.
  - Python: `for x in xs: await f(x)` where `asyncio.gather` fits; `requests.get` in a loop.
  - Go: a loop of blocking RPCs where an `errgroup` fits.
- **Trade-offs:** against a rate-limited upstream, concurrency only moves the wait and can trip the limit. It raises peak memory and connection use. Each item's error needs handling (`Promise.allSettled`, `gather(return_exceptions=True)`, errgroup cancels the rest on the first error).
- **Not a finding:** the second call needs the first's result, or order matters (a write before the read that has to see it).

## 2. Can concurrency go up? What does it cost?

- **Look for:** explicit limits and their current values: batch sizes, connection pools (`maxPoolSize`, SQLAlchemy `pool_size`, an HTTP agent's `maxSockets`), worker counts (pm2, gunicorn or uvicorn workers, Celery or Sidekiq concurrency), queue caps. Also the hidden pools: libuv's `UV_THREADPOOL_SIZE` (default 4, shared by fs, `dns.lookup`, zlib and crypto), Python's default `ThreadPoolExecutor` size, `GOMAXPROCS` in a container.
- **Trade-offs:**
  - every upstream's limit, from the context file;
  - a single-threaded server (Redis) gains no CPU from more clients;
  - CPU-bound work in one process (Node, CPython) only interleaves;
  - threads and processes count against the machine's cores, shared with everything else on it;
  - memory per worker.
- **Report:** the current number, the bound that actually limits it, and what breaks first if it goes up.
- **Not a finding:** raising a limit nothing is queued behind at the real load.

## 3. How many passes? Can it be fewer?

- **Look for:**
  - chained map, filter and reduce over a large collection;
  - the same keys or entries walked several times;
  - serializing to copy (`JSON.parse(JSON.stringify(x))`, `copy.deepcopy` per request);
  - flatten then unflatten, or flattening twice;
  - sorting a whole list to take the top N or one item (`heapq.nlargest`, a single min scan);
  - the same derived value computed in two places.
- **Trade-offs:** one fused loop reads worse than a chain. Keep the chain where the collection is small.
- **Not a finding:** chains over a few dozen items. That's readability, not speed.

## 4. How many allocations? Can it be fewer?

- **Look for:**
  - copying inside a loop: `{ ...acc, [k]: v }` in a reduce is O(n²), so is `list = list + [x]` in Python;
  - Go `append` with no capacity when the size is known;
  - `+=` string building in a hot loop (`"".join`, `strings.Builder`, an array join);
  - buffer copies (`Buffer.concat` per chunk, slicing `bytes` in a loop);
  - a regex compiled or a closure created per item;
  - arrays built only to be iterated once.
- **Trade-offs:** reused buffers and object pools bring aliasing bugs. Check GC pressure is real before pooling.
- **Not a finding:** a cold path, or a few objects per request.

## 5. Is it batching? How big are the batches?

- **Look for:** per-item database, cache or HTTP calls in a loop (N+1): ORM lazy loads in a loop (`select_related` or `prefetch_related`, an `include`, a JOIN), Redis commands without a pipeline, single-row inserts where a bulk insert fits. Also the existing batches and their sizes.
- **Trade-offs:**
  - a huge batch holds a single-threaded server or a lock for its whole run;
  - very long `IN (...)` lists get slow to plan;
  - APIs cap bulk calls, often at 100 items;
  - a failed batch retries everything in it.
- **Report:** the batch size, the item count it sees in practice, and the cap.
- **Not a finding:** a loop with a small, fixed count.

## 6. Is it batching when it should stream?

- **Look for:**
  - loading a whole table or collection (`find({}).toArray()`, `list(Model.objects.all())`, `SELECT *` without a cursor);
  - `KEYS *` where `SCAN` fits;
  - reading a whole file or response when it's only iterated (`readFile` instead of a stream, `f.read()` instead of iterating lines, `io.ReadAll`);
  - building a whole result before the first item could be sent.
- **Trade-offs:** streaming needs backpressure and partial-failure handling, and an open cursor holds server resources.
- **Not a finding:** a result with a small, fixed bound.

## 7. Are we waiting too long? Can work happen during the wait?

- **Look for:**
  - independent work that starts only after an await returns (loading a template, font or config, building the static part of a response);
  - awaiting fire-and-forget work the response doesn't need (logging, analytics, cache writes);
  - an acknowledgment sent late, when a webhook or interaction has a deadline.
- **Trade-offs:**
  - work moved off the awaited path needs its errors handled: an unhandled rejection crashes Node, and an unreferenced asyncio task can be garbage-collected mid-run;
  - ordering must still hold, so the next read still sees the write;
  - say which guarantee changes.
- **Not a finding:** work that needs the awaited result.

## 8. Can it exit early?

- **Look for:**
  - validation, auth or a permission check after the expensive work;
  - a loop that keeps going after it has its answer;
  - `filter()[0]` or `filter().length > 0` (`find`, `some`; Python's `next(...)` and `any`);
  - a full sort for one item;
  - a cache check after the fetch;
  - rendering every page up front when the user sees one;
  - work on an empty input.
- **Trade-offs:** reordering checks can change which error a caller sees first. Say so.
- **Not a finding:** a check that's cheap next to what it guards.

## 9. How many threads? Too many, too few?

- **Look for:** worker threads, child processes and pools (`worker_threads`, `multiprocessing`, unbounded goroutines, a JVM executor), native libraries with their own thread pools (image, compression, crypto), and worker counts in the process manager.
- **Trade-offs:**
  - a worker loads its own copy of caches, and moving data across costs a copy;
  - only CPU work that stalls other requests for 20 ms or more is worth moving;
  - pools times workers above the core count adds context switching;
  - count threads against the shared machine.
- **Not a finding:** I/O-bound work, which an event loop or async runtime already overlaps.

## 10. Right data structure? How is it held in memory?

- **Look for:**
  - `find`, `includes`, `indexOf` or `x in some_list` inside a loop (O(n·m)) where a Map, Set, dict or set fits;
  - linear lookups in a registry on every call;
  - re-sorting after every insert;
  - a cache map with no bound or expiry (a leak);
  - storing what can be derived;
  - large objects kept alive by closures, listeners or timers.
- **Trade-offs:** an index has to be kept in sync and costs memory.
- **Not a finding:** a linear scan over a handful of items.

## 11. How many I/O calls? Can it be fewer?

- **Look for:**
  - the same data fetched twice per request;
  - sync file reads on a per-request path (`readFileSync`, a blocking `open().read()` inside an async handler);
  - HTTP without connection reuse (a bare `requests.get` per item instead of a `Session`, a new Go `http.Client` per request);
  - a public URL where a local one exists;
  - read then write where one command does both (GET then SET, find then update instead of an upsert or `UPDATE ... RETURNING`);
  - config or templates read per request.
- **Trade-offs:** a cache brings staleness. Say how stale is fine.
- **Not a finding:** a read that the OS page cache makes cheap, off the hot loop. A small sync read is about 10–50 µs, so it counts only on a path that runs per item.

## Sizing

Static estimates only, unless the user asks for a bench. Label every number "est."

- **Per occurrence:** count the work from the code (N items × per-item cost). Use the context file's costs when it has them, otherwise these:
  - a local database query by index: 0.5–1 ms;
  - a local Redis command: 0.1–0.2 ms;
  - a loopback HTTP call: about 0.2 ms;
  - a same-region network call: 1–5 ms;
  - a third-party API: 20–200 ms;
  - parsing or serializing 1 MB of JSON: a few ms of CPU.
- **Frequency:** from the context file. Say per request, per job, per day, or once at startup.
- **Floors.** Below these it isn't a finding; list it under "checked, clean". The context file can set its own.
  - a per-request, per-job or per-item path: 1 ms of CPU, 5 ms of latency, or any stall of 20 ms or more;
  - a background job or script: minutes of wall time, or holding a shared resource for 100 ms or more;
  - startup: seconds before ready;
  - memory: any unbounded growth, or 50 MB or more held.
- **Effort:** XS (review or adopt an open PR), S (under a day), M (1–3 days), L (more).
- **Risk:** low, med or high.
- **Output change:** none, or "needs OK" when responses, stored data, ordering, user-visible behavior or an external contract would change.
