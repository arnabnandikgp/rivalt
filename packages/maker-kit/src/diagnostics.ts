/** Keep a bounded failure reason without recording configured or incidental URLs.
 * Redact before truncating so a long connection string cannot be cut into a leak.
 */
export function makerFailureReason(error: unknown, databaseUrl: string): string {
  if (!(error instanceof Error)) return 'Unknown maker failure';
  const message = databaseUrl ? error.message.replaceAll(databaseUrl, '[redacted-database-url]') : error.message;
  return message.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 512) || 'Unknown maker failure';
}
