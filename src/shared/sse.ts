export type SseEvent =
  | { type: 'mark'; actor: string; collected: boolean; mismatch: boolean; by: number; at: number; rev: number }
  | { type: 'marks-bulk'; rev: number }
  | { type: 'import'; rev: number }
  | { type: 'world'; name: string; rev: number }
  | { type: 'members' }
  | { type: 'removed'; userId: number }
  | { type: 'deleted' }
  | { type: 'routes'; rev: number };

export function encodeSse(e: SseEvent): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}
