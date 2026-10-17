import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` tasks at the same time', async () => {
    let running = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      5,
      async (i) => {
        running++;
        peak = Math.max(peak, running);
        await sleep(5 + (i % 3) * 5);
        running--;
      },
    );

    expect(peak).toBe(5);
  });

  it('returns results in input order, even when later items finish first', async () => {
    const results = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await sleep(ms);
      return ms;
    });
    expect(results.map((result) => result.status === 'fulfilled' && result.value)).toEqual([30, 10, 20]);
  });

  it('keeps going when one item fails', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it("doesn't let one slow item hold up the rest", async () => {
    // Two workers: the slow item ties up one of them, the other works through all the
    // fast ones. (Fixed batches of two would make the second fast item wait for it.)
    const finished: number[] = [];
    await mapWithConcurrency([200, 10, 10, 10, 10], 2, async (ms) => {
      await sleep(ms);
      finished.push(ms);
    });
    expect(finished).toEqual([10, 10, 10, 10, 200]);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });
});
