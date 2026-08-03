// Pure scheduling math — no DB, no clock reads baked in (the `now` is passed),
// so it's fully unit-testable.

// After this many consecutive failures a connection is parked in `error` and
// stops being scheduled until a human reconnects / resumes it.
export const MAX_CONSECUTIVE_FAILURES = 5;

// Exponential backoff capped at 6h, applied to the *interval* after a failure.
const MAX_BACKOFF_SECONDS = 6 * 60 * 60;

export function backoffSeconds(
  intervalSeconds: number,
  consecutiveFailures: number,
): number {
  if (consecutiveFailures <= 0) return intervalSeconds;
  const factor = 2 ** Math.min(consecutiveFailures, 10);
  return Math.min(intervalSeconds * factor, MAX_BACKOFF_SECONDS);
}

export function nextRunAfterSuccess(now: Date, intervalSeconds: number): Date {
  return new Date(now.getTime() + intervalSeconds * 1000);
}

export function nextRunAfterFailure(
  now: Date,
  intervalSeconds: number,
  consecutiveFailures: number,
): Date {
  return new Date(
    now.getTime() + backoffSeconds(intervalSeconds, consecutiveFailures) * 1000,
  );
}

// Whether a failing connection has exhausted its retries and should be parked.
export function shouldPark(consecutiveFailures: number): boolean {
  return consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
}
