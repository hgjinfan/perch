import test from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetedFetcher } from '../src/request-budget.js';

test('shared fetch budget holds permits through body reads and bounds its queue', async () => {
  let finish;
  let calls = 0;
  const fetcher = createBudgetedFetcher(
    async () => {
      calls++;
      return calls === 1
        ? new Response(
            new ReadableStream({
              start(controller) {
                finish = () => {
                  controller.enqueue(new Uint8Array([65]));
                  controller.close();
                };
              },
            }),
          )
        : new Response('next');
    },
    { env: { UPSTREAM_CONCURRENCY: 1, UPSTREAM_MAX_QUEUE: 1 } },
  );
  const first = fetcher('https://example.com/one');
  await Promise.resolve();
  const second = fetcher('https://example.com/two');
  await assert.rejects(fetcher('https://other.example/three'), { status: 503 });
  assert.equal(calls, 1);
  finish();
  assert.equal(await (await first).text(), 'A');
  assert.equal(await (await second).text(), 'next');
});

test('budget preserves reachable authentication status and isolates provider cooldown', async () => {
  let calls = 0;
  const fetcher = createBudgetedFetcher(async (url) => {
    calls++;
    return new Response(null, { status: url.includes('busy') ? 429 : 401 });
  });
  assert.equal((await fetcher('https://auth.example/')).status, 401);
  assert.equal((await fetcher('https://busy.example/')).status, 429);
  await assert.rejects(fetcher('https://busy.example/again'), { status: 503 });
  assert.equal(calls, 2);
  assert.equal((await fetcher('https://auth.example/again')).status, 401);
});

test('oversized bodies release permits and pre-aborted work does not contact upstream', async () => {
  let calls = 0;
  const fetcher = createBudgetedFetcher(
    async () => {
      calls++;
      return new Response(new Uint8Array(1024 * 1024 + 1));
    },
    { env: { UPSTREAM_CONCURRENCY: 1 } },
  );
  await assert.rejects(fetcher('https://example.com/'), /Response too large/);
  await assert.rejects(fetcher('https://example.com/', { signal: AbortSignal.abort() }), {
    name: 'AbortError',
  });
  assert.equal(calls, 1);
});

test('per-origin isolation, foreground priority, and queued abort cleanup', async () => {
  const { createUpstreamBudget } = await import('../src/request-budget.js');
  const budget = createUpstreamBudget({ concurrency: 2, perKeyConcurrency: 1, maxQueue: 5 });
  let release;
  const started = [];
  const first = budget.run(
    'slow',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController();
  const cancelled = budget.run('slow', async () => started.push('cancelled'), {
    signal: controller.signal,
  });
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  controller.abort();
  await rejected;
  await budget.run('healthy', async () => started.push('healthy'));
  assert.deepEqual(started, ['healthy']);
  const background = budget.run('slow', async () => started.push('background'), {
    background: true,
  });
  const foreground = budget.run('slow', async () => started.push('foreground'));
  release();
  await Promise.all([first, background, foreground]);
  assert.deepEqual(started, ['healthy', 'foreground', 'background']);
  const snapshot = budget.snapshot();
  assert.equal(snapshot.active, 0);
  assert.equal(snapshot.queued, 0);
  assert.equal(snapshot.cancelled, 1);
  assert.ok(!JSON.stringify(snapshot).includes('healthy'));
});

test('health checks cancel the body immediately and retain HTTP status', async () => {
  let cancelled = false;
  const fetcher = createBudgetedFetcher(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  assert.equal((await fetcher('https://example.com/', { headersOnly: true })).status, 200);
  assert.equal(cancelled, true);
  assert.equal(fetcher.snapshot().active, 0);
});

test('older concurrent success cannot erase a newer provider cooldown', async () => {
  const { createUpstreamBudget } = await import('../src/request-budget.js');
  const budget = createUpstreamBudget({ concurrency: 2 });
  let fail, succeed;
  const first = budget.run(
    'provider',
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const second = budget.run(
    'provider',
    () =>
      new Promise((resolve) => {
        succeed = resolve;
      }),
  );
  const rejected = assert.rejects(first, /HTTP 429/);
  fail(new Error('HTTP 429'));
  await rejected;
  succeed('ok');
  await second;
  assert.equal(budget.snapshot().cooling, 1);
  await assert.rejects(
    budget.run('provider', async () => 'must not run'),
    { status: 503 },
  );
});
