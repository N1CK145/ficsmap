import { encodeSse, type SseEvent } from '../../shared/sse.js';

interface Client {
  userId: number;
  write: (chunk: string) => void;
  close: () => void;
}

/**
 * In-memory fan-out of world events to open SSE streams. It also knows who is in a world right now (presence): the
 * users with at least one open stream. Whenever that set changes, every stream of the world gets a `presence` event;
 * a stream that joins without changing it (a second tab) gets the list for itself.
 */
export class SseHub {
  private readonly worlds = new Map<string, Set<Client>>();

  /** Registers a stream; returns an unsubscribe function. */
  add(worldId: string, userId: number, write: (chunk: string) => void, close: () => void): () => void {
    const client: Client = { userId, write, close };
    let set = this.worlds.get(worldId);
    if (!set) this.worlds.set(worldId, (set = new Set()));
    const isNew = !this.presence(worldId).includes(userId);
    set.add(client);
    if (isNew) {
      this.broadcastPresence(worldId);
    } else {
      try {
        write(encodeSse({ type: 'presence', userIds: this.presence(worldId) }));
      } catch {
        this.remove(worldId, client);
      }
    }
    return () => this.remove(worldId, client);
  }

  /** The users with an open stream in the world, ascending. */
  presence(worldId: string): number[] {
    return [...new Set([...(this.worlds.get(worldId) ?? [])].map(c => c.userId))].sort((a, b) => a - b);
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

  private broadcastPresence(worldId: string): void {
    this.broadcast(worldId, { type: 'presence', userIds: this.presence(worldId) });
  }

  private remove(worldId: string, c: Client): void {
    const set = this.worlds.get(worldId);
    if (!set?.delete(c)) return;
    if (set.size === 0) this.worlds.delete(worldId);
    if (!this.presence(worldId).includes(c.userId)) this.broadcastPresence(worldId);
  }
}
