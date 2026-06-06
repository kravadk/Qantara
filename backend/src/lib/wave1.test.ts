import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { incCounter, observeLatency, renderRequestMetrics, resetMetrics, setGauge } from './metrics.js';
import { rateLimit } from '../middleware/http.js';

test('metrics: counters, gauges, and latency histogram render in Prometheus format', () => {
  resetMetrics();
  incCounter('qie_test_total', { route: '/x' }, 2);
  incCounter('qie_test_total', { route: '/x' });
  setGauge('qie_test_gauge', 5);
  observeLatency('qie_test_latency_seconds', 30, { route: '/x' });
  observeLatency('qie_test_latency_seconds', 800, { route: '/x' });

  const out = renderRequestMetrics();
  assert.match(out, /# TYPE qie_test_total counter/);
  assert.match(out, /qie_test_total\{route="\/x"\} 3/);
  assert.match(out, /qie_test_gauge 5/);
  assert.match(out, /qie_test_latency_seconds_count\{route="\/x"\} 2/);
  // 30ms falls in the <=0.05s bucket; both observations fall in <=1s and +Inf.
  assert.match(out, /qie_test_latency_seconds_bucket\{le="0\.05",route="\/x"\} 1/);
  assert.match(out, /qie_test_latency_seconds_bucket\{le="1",route="\/x"\} 2/);
  assert.match(out, /qie_test_latency_seconds_bucket\{le="\+Inf",route="\/x"\} 2/);
  resetMetrics();
});

function fakeReqRes(ip: string) {
  let statusCode = 0;
  let nexted = false;
  const req = { headers: {}, ip, socket: {} } as unknown as Request;
  const res = {
    setHeader() {},
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  return {
    run(limiter: (req: Request, res: Response, next: () => void) => void) {
      statusCode = 0;
      nexted = false;
      limiter(req, res, () => {
        nexted = true;
      });
      return { statusCode, nexted };
    },
  };
}

test('rateLimit: allows up to max then returns 429', () => {
  delete process.env.RATE_LIMIT_DISABLED;
  const limiter = rateLimit({ max: 2, windowMs: 60_000 });
  const harness = fakeReqRes('1.2.3.4');
  assert.equal(harness.run(limiter).nexted, true);
  assert.equal(harness.run(limiter).nexted, true);
  const third = harness.run(limiter);
  assert.equal(third.nexted, false);
  assert.equal(third.statusCode, 429);
});

test('rateLimit: bypasses entirely when RATE_LIMIT_DISABLED=true', () => {
  process.env.RATE_LIMIT_DISABLED = 'true';
  const limiter = rateLimit({ max: 1 });
  const harness = fakeReqRes('9.9.9.9');
  let allowed = 0;
  for (let i = 0; i < 5; i += 1) {
    if (harness.run(limiter).nexted) allowed += 1;
  }
  assert.equal(allowed, 5);
  delete process.env.RATE_LIMIT_DISABLED;
});
