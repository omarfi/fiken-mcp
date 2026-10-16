/**
 * Structured log line for Workers Logs. Metadata only: never tokens, e-mail addresses or
 * accounting data.
 */
export function log(event: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}
