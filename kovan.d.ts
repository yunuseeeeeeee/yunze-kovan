export interface HiveOptions {
  initial?: Record<string, any>;
  heartbeat?: number;
  timeout?: number;
  settle?: number;
  requestTimeout?: number;
  Channel?: typeof BroadcastChannel;
}

export interface Hive<S extends Record<string, any> = Record<string, any>> {
  readonly id: string;
  readonly ready: Promise<void>;
  readonly state: S;
  readonly isLeader: boolean;
  readonly leaderId: string | null;
  peers(): string[];
  get(): S;
  set(patch: Partial<S> | ((s: S) => Partial<S>)): void;
  subscribe(fn: (state: S, info: { remote: boolean }) => void): () => void;
  onLeader(fn: () => void | (() => void)): () => void;
  handle(name: string, fn: (payload: any) => any): () => void;
  request<T = any>(name: string, payload?: any, opts?: { timeout?: number }): Promise<T>;
  emit(event: string, data?: any, opts?: { self?: boolean }): void;
  on(event: string, fn: (data: any) => void): () => void;
  close(): void;
}

export function createHive<S extends Record<string, any> = Record<string, any>>(
  name: string,
  opts?: HiveOptions
): Hive<S>;
