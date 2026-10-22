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
  await assert.rejects(fetcher('https://busy.example/'), /HTTP 429/);
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
