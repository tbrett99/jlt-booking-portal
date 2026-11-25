/** Read-only deadline: abandoning a result does not cancel or repeat its query. */
export async function hqReadDeadline<T>(
  work: () => Promise<T>,
  milliseconds = 10000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("HQ_READ_DEADLINE")),
          milliseconds
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
