/**
 * Process-local serialization for guided-demo mutations.
 * Not a distributed lock — suitable for single-process portfolio deployments.
 */

const chains = new Map<string, Promise<unknown>>();

export async function withDemoLock<T>(
  demoId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = chains.get(demoId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => undefined).then(() => gate);
  chains.set(demoId, next);

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    // Drop the chain entry once this lock's successors have settled if we are still tail.
    void next.finally(() => {
      if (chains.get(demoId) === next) {
        chains.delete(demoId);
      }
    });
  }
}

/** Test helper — expose active lock count. */
export function activeDemoLockCount(): number {
  return chains.size;
}
