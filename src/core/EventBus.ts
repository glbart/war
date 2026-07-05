type Handler = (payload: unknown) => void;

// Типизированный pub/sub. Ключ E — карта {имяСобытия: типПейлоада}.
export class EventBus<E> {
  private handlers = new Map<keyof E, Set<Handler>>();

  on<K extends keyof E>(type: K, fn: (e: E[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler);
    return () => set!.delete(fn as Handler);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
