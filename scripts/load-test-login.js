#!/usr/bin/env node
/**
 * Login load test. Measures real capacity instead of guessing.
 *
 *   LOAD_EMAIL=loadtest@example.com LOAD_PASSWORD='Passw0rd!' \
 *   node scripts/load-test-login.js --url http://localhost:5000 --total 2000 --concurrency 100
 *
 * Flags:
 *   --url          API base URL (default http://localhost:5000)
 *   --total        total login attempts (default 1000)
 *   --concurrency  in-flight requests (default 50)
 *   --yes          required for any non-local URL (only test systems you own)
 *
 * Use a dedicated test account on a staging copy. The general API limiter allows
 * 200 anonymous requests/min per IP, so from ONE machine you will mostly see 429s.
 * On staging raise API_RATE_LIMIT_PER_MIN (and RATE_LIMIT_MAX_KEYS), or run the
 * generator from many hosts.
 *
 * Healthy result under overload: a mix of 200 and 503 (AUTH_BUSY) with a low
 * p99 for the 503s, and /api/health still answering. Unhealthy: timeouts,
 * connection resets, or 5xx other than 503.
 */
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : [])),
);
const base = String(args.url || "http://localhost:5000").replace(/\/+$/, "");
const total = Number(args.total) || 1000;
const concurrency = Math.min(Number(args.concurrency) || 50, total);
const email = process.env.LOAD_EMAIL;
const password = process.env.LOAD_PASSWORD;

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(base);
if (!email || !password) {
  console.error("Set LOAD_EMAIL and LOAD_PASSWORD (a dedicated test account).");
  process.exit(2);
}
if (!isLocal && !args.yes) {
  console.error(`Refusing to load-test ${base} without --yes. Only test systems you own.`);
  process.exit(2);
}

const latencies = [];
const statuses = new Map();
let issued = 0;

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function worker() {
  while (issued < total) {
    issued += 1;
    const started = performance.now();
    let key;
    try {
      const response = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-platform": "loadtest" },
        body: JSON.stringify({ email, password, client: "loadtest" }),
        signal: AbortSignal.timeout(30_000),
      });
      await response.arrayBuffer();
      key = String(response.status);
    } catch (error) {
      key = error?.name === "TimeoutError" ? "timeout" : "network-error";
    }
    latencies.push(performance.now() - started);
    statuses.set(key, (statuses.get(key) || 0) + 1);
  }
}

(async () => {
  console.log(`POST ${base}/api/auth/login  total=${total} concurrency=${concurrency}`);
  const startedAt = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const seconds = (performance.now() - startedAt) / 1000;
  latencies.sort((a, b) => a - b);

  console.log(`\nfinished in ${seconds.toFixed(1)}s  ->  ${(total / seconds).toFixed(1)} requests/s`);
  console.log("status codes:", Object.fromEntries([...statuses].sort()));
  console.log(
    `latency ms  p50=${percentile(latencies, 50).toFixed(0)}  p95=${percentile(latencies, 95).toFixed(0)}  p99=${percentile(latencies, 99).toFixed(0)}  max=${latencies.at(-1)?.toFixed(0)}`,
  );
  const ok = statuses.get("200") || 0;
  console.log(`successful sign-ins/s: ${(ok / seconds).toFixed(1)}  (this is one instance's real capacity)`);
  const bad = [...statuses].filter(([k]) => !["200", "401", "429", "503"].includes(k));
  if (bad.length) {
    console.log("UNHEALTHY responses:", Object.fromEntries(bad));
    process.exitCode = 1;
  }
})();
