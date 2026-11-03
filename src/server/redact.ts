/** Invite JWTs are bearer secrets; keep them out of request logs. */
export function redactUrl(url: string): string {
  return url
    .replace(/^(\/invite\/)[^/?#]*/, '$1[redacted]')
    .replace(/([?&]invite=)[^&#]*/g, '$1[redacted]');
}
