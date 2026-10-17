/**
 * Like Promise.allSettled(items.map(fn)), but with at most `limit` calls running at once.
 *
 * It is a small worker pool: `limit` workers each take the next unclaimed item until
 * none are left. A slow item ties up only its own worker while the others keep going.
 * (Splitting the list into fixed batches of `limit` would be worse: every batch would
 * wait for its slowest member before the next batch could start.)
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      // Claiming an index needs no lock: JavaScript runs one piece of code at a time,
      // so nothing can run between reading nextIndex and incrementing it.
      const index = nextIndex++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index] as T) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
