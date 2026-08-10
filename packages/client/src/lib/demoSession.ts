const DEMO_SESSION_KEY = "applyready.publicDemoApplicationId";

export function readDemoId(): string | null {
  try {
    return sessionStorage.getItem(DEMO_SESSION_KEY);
  } catch {
    return null;
  }
}

export function rememberDemoId(id: string | null): void {
  try {
    if (!id) sessionStorage.removeItem(DEMO_SESSION_KEY);
    else sessionStorage.setItem(DEMO_SESSION_KEY, id);
  } catch {
    // Private mode / blocked storage — demo still works without refresh restore.
  }
}

/** Clear only when the stored id matches — never wipe an unrelated active session. */
export function clearDemoIdIfMatches(id: string): void {
  if (readDemoId() === id) {
    rememberDemoId(null);
  }
}
