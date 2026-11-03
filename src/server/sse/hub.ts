import { encodeSse, type SseEvent } from '../../shared/sse.js';

interface Client {
  userId: number;
  write: (chunk: string) => void;
  close: () => void;
}

/** In-memory fan-out of world events to open SSE streams. */
export class SseHub {
  private readonly worlds = new Map<string, Set<Client>>();

  /** Registers a stream; returns an unsubscribe function. */
  add(worldId: string, userId: number, write: (chunk: string) => void, close: () => void): () => void {
    const client: Client = { userId, write, close };
    let set = this.worlds.get(worldId);
    if (!set) this.worlds.set(worldId, (set = new Set()));
    set.add(client);
    return () => this.remove(worldId, client);
  }

  broadcast(worldId: string, e: SseEvent): void {
    const chunk = encodeSse(e);
    for (const c of [...(this.worlds.get(worldId) ?? [])]) {
      try {
        c.write(chunk);
      } catch {
        this.remove(worldId, c);
      }
    }
  }

  closeUser(worldId: string, userId: number): void {
    for (const c of [...(this.worlds.get(worldId) ?? [])]) {
      if (c.userId === userId) this.closeClient(worldId, c);
    }
  }

  /** Closes a user's streams in every world (logout). */
  closeUserEverywhere(userId: number): void {
    for (const id of [...this.worlds.keys()]) this.closeUser(id, userId);
  }

  closeWorld(worldId: string): void {
    for (const c of [...(this.worlds.get(worldId) ?? [])]) this.closeClient(worldId, c);
  }

  closeAll(): void {
    for (const id of [...this.worlds.keys()]) this.closeWorld(id);
  }

  size(worldId: string): number {
    return this.worlds.get(worldId)?.size ?? 0;
  }

  private closeClient(worldId: string, c: Client): void {
    this.remove(worldId, c);
    try {
      c.close();
    } catch {
      /* stream already gone */
    }
  }

  private remove(worldId: string, c: Client): void {
    const set = this.worlds.get(worldId);
    if (!set) return;
    set.delete(c);
    if (set.size === 0) this.worlds.delete(worldId);
  }
}
