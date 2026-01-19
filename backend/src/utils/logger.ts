/**
 * Simple logging utility for the backend.
 *
 * Design Decision (D012): We use a minimal custom logger rather than a full
 * logging framework (winston, pino, etc.) to save time. This logs full stack
 * traces to the console for debugging while keeping user-facing error messages
 * generic for security.
 *
 * For production, consider:
 * - Structured logging (JSON format)
 * - Log levels (debug, info, warn, error)
 * - Log aggregation (DataDog, CloudWatch, etc.)
 * - Request correlation IDs
 */

interface LogContext {
  operation: string;
  propertyId?: string;
  residentId?: string;
  eventId?: string;
  [key: string]: unknown;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatContext(context: LogContext): string {
  const { operation, ...rest } = context;
  const contextParts = Object.entries(rest)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return contextParts ? `[${operation}] ${contextParts}` : `[${operation}]`;
}

export function logError(context: LogContext, error: unknown): void {
  const timestamp = formatTimestamp();
  const contextStr = formatContext(context);

  console.error(`\n${'='.repeat(60)}`);
  console.error(`[ERROR] ${timestamp} ${contextStr}`);

  if (error instanceof Error) {
    console.error(`Message: ${error.message}`);
    if (error.stack) {
      console.error(`Stack trace:\n${error.stack}`);
    }
  } else {
    console.error(`Error: ${JSON.stringify(error, null, 2)}`);
  }

  console.error(`${'='.repeat(60)}\n`);
}

export function logInfo(context: LogContext, message: string): void {
  const timestamp = formatTimestamp();
  const contextStr = formatContext(context);
  console.log(`[INFO] ${timestamp} ${contextStr} - ${message}`);
}

export function logWarn(context: LogContext, message: string): void {
  const timestamp = formatTimestamp();
  const contextStr = formatContext(context);
  console.warn(`[WARN] ${timestamp} ${contextStr} - ${message}`);
}
