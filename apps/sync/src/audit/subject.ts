import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which prisme entity an outward call is being made for.
 *
 * The writer ports know an external id and a draft; they do not know which
 * initiative an anchor update belongs to, and should not — a port that took an
 * entity would let a caller name one it was not acting for. The pass does
 * know, so it says so around the calls it makes, and the audit sink reads it
 * when it records them (ADR-0031).
 *
 * Carried in async context rather than threaded through the writer's
 * signature, so the ports stay exactly the shape the ownership matrix gave
 * them, and a call made outside any subject is recorded without one rather
 * than refused: the record is still true, it is only less specific.
 */
export interface WriteSubject {
  readonly entityKind: string;
  readonly entityId: string;
}

const storage = new AsyncLocalStorage<WriteSubject>();

export function withWriteSubject<T>(
  subject: WriteSubject | undefined,
  perform: () => Promise<T>,
): Promise<T> {
  return subject === undefined ? perform() : storage.run(subject, perform);
}

export function currentWriteSubject(): WriteSubject | undefined {
  return storage.getStore();
}
