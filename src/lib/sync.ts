/**
 * @ballah/synced - State Synchronization Library v2
 *
 * A clean, decorator-based approach to syncing state between
 * TypeScript backend and frontend.
 *
 * Features:
 * - @synced on properties: marks them for sync, wraps in Synced<T> for arrays/objects
 * - @rpc on methods: marks them as callable from frontend
 * - @manager on session properties: auto-wires managers with session reference and name
 * - Synced<T> wrapper: use .mutate() for in-place changes, .set() for replacement
 *
 * @example
 * class NotesManager extends SyncedManager {
 *   @synced notes = synced<Note[]>([]);
 *   @synced generating = false;
 *
 *   @rpc
 *   async addNote(note: Note) {
 *     this.notes.mutate(n => n.push(note));
 *     return note;
 *   }
 * }
 *
 * class MySession extends SyncedSession {
 *   @manager notes = new NotesManager();
 *   @manager todos = new TodosManager();
 * }
 */

// =============================================================================
// Synced<T> - Wrapper type for synced properties
// =============================================================================

const SYNCED_INTERNAL = Symbol("synced_internal");

interface SyncedInternal<T> {
  value: T;
  broadcast: () => void;
}

/**
 * Synced<T> - A value that syncs to clients.
 *
 * For arrays/objects, provides .mutate() and .sync() methods.
 * Access the value directly (this.notes.length) or use .set() to replace.
 */
export type Synced<T> = T & {
  /** Replace the entire value */
  set(newValue: T): void;
  /** Mutate in place, then auto-sync */
  mutate(fn: (draft: T) => void): void;
  /** Manually trigger sync (if you mutated via direct access) */
  sync(): void;
};

/**
 * Create a Synced<T> wrapper around a value.
 * The proxy delegates all property access to the underlying value,
 * while also providing .set(), .mutate(), and .sync() methods.
 */
function createSynced<T>(initial: T, broadcast: () => void): Synced<T> {
  const internal: SyncedInternal<T> = {
    value: initial,
    broadcast,
  };

  // For primitives, we don't create a Synced wrapper
  // This function should only be called for objects/arrays
  if (typeof initial !== "object" || initial === null) {
    throw new Error(
      `createSynced() should only be used for objects/arrays, got ${typeof initial}. ` +
        `Primitives are auto-synced on reassignment.`,
    );
  }

  // For objects/arrays, create a proxy that delegates to the value
  return new Proxy(internal.value as object, {
    get(target, prop) {
      // Our special methods
      if (prop === SYNCED_INTERNAL) return internal;

      if (prop === "set") {
        return (newValue: T) => {
          internal.value = newValue;
          internal.broadcast();
        };
      }

      if (prop === "mutate") {
        return (fn: (draft: T) => void) => {
          fn(internal.value);
          internal.broadcast();
        };
      }

      if (prop === "sync") {
        return () => internal.broadcast();
      }

      // Delegate to the actual value
      const value = (internal.value as any)[prop];

      // Bind functions so methods like .map(), .filter() work correctly
      if (typeof value === "function") {
        return value.bind(internal.value);
      }

      return value;
    },

    set(target, prop, newValue) {
      (internal.value as any)[prop] = newValue;
      // Note: direct property sets don't auto-broadcast
      // Use .mutate() or .sync() for that
      return true;
    },

    // Make Array.isArray() work
    getPrototypeOf() {
      return Object.getPrototypeOf(internal.value);
    },

    // Make spread operator and iteration work
    ownKeys() {
      return Reflect.ownKeys(internal.value as object);
    },

    getOwnPropertyDescriptor(target, prop) {
      return Object.getOwnPropertyDescriptor(internal.value as object, prop);
    },

    has(target, prop) {
      return prop in (internal.value as object);
    },
  }) as Synced<T>;
}

/**
 * Unwrap a Synced<T> to get the raw value (for serialization)
 */
function unwrapSynced<T>(synced: Synced<T> | T): T {
  const internal = (synced as any)?.[SYNCED_INTERNAL] as
    | SyncedInternal<T>
    | undefined;
  return internal ? internal.value : (synced as T);
}

/**
 * Check if a value is a Synced<T> wrapper
 */
function isSynced(value: any): boolean {
  return value && typeof value === "object" && SYNCED_INTERNAL in value;
}

// =============================================================================
// Decorator Registry
// =============================================================================

const syncedRegistry = new Map<any, Set<string>>();
const rpcRegistry = new Map<any, Set<string>>();
const managerRegistry = new Map<any, Set<string>>();

/**
 * @synced - Mark a property to sync to all connected clients.
 *
 * Two usages:
 * 1. As a decorator: @synced
 * 2. As an initializer helper: synced<T>(value)
 *
 * For arrays and objects, wraps in Synced<T> which provides:
 * - .set(newValue) - replace entire value
 * - .mutate(fn) - mutate in place with auto-sync
 * - .sync() - manual sync trigger
 *
 * For primitives, just use reassignment (auto-syncs).
 *
 * @example
 * class NotesManager extends SyncedManager {
 *   @synced notes = synced<Note[]>([]);
 *   @synced generating = false;
 *
 *   addNote(note: Note) {
 *     // For arrays, use mutate:
 *     this.notes.mutate(n => n.push(note));
 *
 *     // For primitives, just reassign:
 *     this.generating = true;
 *   }
 * }
 */
// Overload: decorator usage
export function synced(target: any, propertyKey: string): void;
// Overload: initializer helper usage
export function synced<T>(initial: T): Synced<T>;
// Implementation
export function synced(targetOrInitial: any, propertyKey?: string): any {
  // If called with two arguments, it's being used as a decorator
  if (propertyKey !== undefined) {
    const constructor = targetOrInitial.constructor;
    if (!syncedRegistry.has(constructor)) {
      syncedRegistry.set(constructor, new Set());
    }
    syncedRegistry.get(constructor)!.add(propertyKey);
    return;
  }

  // If called with one argument, it's being used as an initializer helper
  // synced<Note[]>([]) -> returns the value cast to Synced<T>
  return targetOrInitial as unknown as Synced<typeof targetOrInitial>;
}

/**
 * @rpc - Mark a method as callable from frontend.
 *
 * @example
 * class NotesManager extends SyncedManager {
 *   @rpc
 *   async createNote(title: string): Promise<Note> {
 *     const note = { id: Date.now(), title };
 *     this.notes.mutate(n => n.push(note));
 *     return note;
 *   }
 * }
 */
export function rpc(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) {
  const constructor = target.constructor;
  if (!rpcRegistry.has(constructor)) {
    rpcRegistry.set(constructor, new Set());
  }
  rpcRegistry.get(constructor)!.add(propertyKey);
  return descriptor;
}

/**
 * @manager - Mark a property as a manager on a session.
 *
 * Auto-wires:
 * - Injects session reference (_session)
 * - Infers name from property key (_name)
 * - Registers with session
 * - Sets up Synced<T> wrappers for @synced properties
 *
 * @example
 * class MySession extends SyncedSession {
 *   @manager notes = new NotesManager();
 *   @manager todos = new TodosManager();
 * }
 */
export function manager(target: any, propertyKey: string) {
  const constructor = target.constructor;
  if (!managerRegistry.has(constructor)) {
    managerRegistry.set(constructor, new Set());
  }
  managerRegistry.get(constructor)!.add(propertyKey);
}

// =============================================================================
// Helper functions for registry access
// =============================================================================

function getSyncedFields(constructor: any): string[] {
  const fields: string[] = [];
  let proto = constructor;

  // Walk prototype chain to collect inherited @synced fields
  while (proto && proto !== Object) {
    const protoFields = syncedRegistry.get(proto);
    if (protoFields) {
      fields.push(...protoFields);
    }
    proto = Object.getPrototypeOf(proto);
  }

  return [...new Set(fields)];
}

function getRPCMethods(constructor: any): string[] {
  const methods: string[] = [];
  let proto = constructor;

  while (proto && proto !== Object) {
    const protoMethods = rpcRegistry.get(proto);
    if (protoMethods) {
      methods.push(...protoMethods);
    }
    proto = Object.getPrototypeOf(proto);
  }

  return [...new Set(methods)];
}

function getManagerFields(constructor: any): string[] {
  const fields: string[] = [];
  let proto = constructor;

  while (proto && proto !== Object) {
    const protoFields = managerRegistry.get(proto);
    if (protoFields) {
      fields.push(...protoFields);
    }
    proto = Object.getPrototypeOf(proto);
  }

  return [...new Set(fields)];
}

// =============================================================================
// SyncedManager - Base class for managers
// =============================================================================

/**
 * Base class for managers. Extend this for each domain (notes, todos, etc.).
 *
 * The @manager decorator on the session will inject:
 * - _session: reference to parent session
 * - _name: manager name (inferred from property key)
 *
 * @example
 * class NotesManager extends SyncedManager {
 *   @synced notes = synced<Note[]>([]);
 *
 *   @rpc
 *   async addNote(note: Note) {
 *     this.notes.mutate(n => n.push(note));
 *   }
 * }
 */
export abstract class SyncedManager {
  /** Reference to parent session (injected by @manager decorator) */
  _session!: SyncedSession;

  /** Manager name, e.g., "notes" (injected by @manager decorator) */
  _name!: string;

  /** Called when session hydrates - override to load from DB */
  async hydrate(): Promise<void> {}

  /** Called when session persists - override to save to DB */
  async persist(): Promise<void> {}

  /** Called when session is disposed - override to stop timers/intervals */
  destroy(): void {}

  /** Get list of synced field names */
  getSyncedFields(): string[] {
    return getSyncedFields(this.constructor);
  }

  /** Get list of RPC method names */
  getRPCMethods(): string[] {
    return getRPCMethods(this.constructor);
  }

  /** Get current state snapshot (synced fields only, unwrapped) */
  getState(): Record<string, any> {
    const state: Record<string, any> = {};
    for (const field of this.getSyncedFields()) {
      state[field] = unwrapSynced((this as any)[field]);
    }
    return state;
  }
}

/**
 * Check if a value is a primitive (not an object/array)
 */
function isPrimitive(value: any): boolean {
  return (
    value === null || (typeof value !== "object" && typeof value !== "function")
  );
}

/**
 * Initialize a manager - called by @manager decorator.
 * Wraps @synced properties in Synced<T> (for objects/arrays) and sets up broadcasting.
 * Primitives are NOT wrapped - they auto-sync on reassignment via the proxy.
 *
 * Returns a proxied version of the manager that intercepts property sets.
 */
function initializeManager<T extends SyncedManager>(
  managerInstance: T,
  session: SyncedSession,
  name: string,
): T {
  managerInstance._session = session;
  managerInstance._name = name;

  const syncedFields = managerInstance.getSyncedFields();

  for (const field of syncedFields) {
    const initialValue = (managerInstance as any)[field];

    // Skip if already a Synced wrapper
    if (isSynced(initialValue)) {
      continue;
    }

    // Only wrap objects/arrays in Synced<T>
    // Primitives stay as-is and are handled by the proxy below
    if (!isPrimitive(initialValue)) {
      const broadcast = () => {
        session.broadcastStateChange(
          name,
          field,
          unwrapSynced((managerInstance as any)[field]),
        );
      };
      const syncedValue = createSynced(initialValue, broadcast);
      (managerInstance as any)[field] = syncedValue;
    }
  }

  // Set up a proxy to intercept reassignments of synced fields
  // This handles:
  // - Primitives: this.generating = true (auto-syncs)
  // - Objects/arrays: this.notes = [...] (re-wraps and syncs)
  const proxy = new Proxy(managerInstance, {
    set(target, prop, value) {
      const propStr = prop as string;

      // If reassigning a synced field
      if (syncedFields.includes(propStr)) {
        // For primitives, just assign and broadcast
        if (isPrimitive(value)) {
          (target as any)[propStr] = value;
          session.broadcastStateChange(name, propStr, value);
          return true;
        }

        // For objects/arrays, wrap in Synced<T> if not already
        if (!isSynced(value)) {
          const broadcast = () => {
            session.broadcastStateChange(
              name,
              propStr,
              unwrapSynced((target as any)[propStr]),
            );
          };
          value = createSynced(value, broadcast);
        }

        (target as any)[propStr] = value;

        // Broadcast the change
        session.broadcastStateChange(name, propStr, unwrapSynced(value));
        return true;
      }

      // Normal assignment for non-synced fields
      (target as any)[propStr] = value;
      return true;
    },
  });

  return proxy as T;
}

// =============================================================================
// SyncedSession - Base class for user sessions
// =============================================================================

type WSMessage =
  | { type: "connected" }
  | { type: "snapshot"; state: Record<string, any> }
  | { type: "state_change"; manager: string; property: string; value: any }
  | {
      type: "rpc_request";
      id: string;
      manager: string;
      method: string;
      args: any[];
    }
  | { type: "rpc_response"; id: string; result?: any; error?: string };

/**
 * Base class for user sessions. Container for all managers.
 *
 * Use @manager decorator on properties to auto-wire managers.
 *
 * @example
 * class MySession extends SyncedSession {
 *   @manager notes = new NotesManager();
 *   @manager todos = new TodosManager();
 * }
 */
export abstract class SyncedSession {
  readonly userId: string;

  private _clients: Set<any> = new Set();
  private _managers: Map<string, SyncedManager> = new Map();
  private _hydrated = false;
  private _initialized = false;

  constructor(userId: string) {
    this.userId = userId;

    // Schedule initialization for after subclass constructor completes
    // This ensures all @manager properties are assigned before we initialize them
    queueMicrotask(() => this._initializeManagers());
  }

  /**
   * Ensure managers are initialized (call this if you need immediate access)
   */
  protected _ensureInitialized(): void {
    if (!this._initialized) {
      this._initializeManagers();
    }
  }

  /**
   * Initialize managers marked with @manager decorator
   */
  private _initializeManagers(): void {
    if (this._initialized) return;
    this._initialized = true;

    const managerFields = getManagerFields(this.constructor);

    for (const field of managerFields) {
      const managerInstance = (this as any)[field];

      if (!managerInstance) {
        console.warn(
          `[SyncedSession] Manager '${field}' is undefined. Make sure to initialize it with: @manager ${field} = new ${field.charAt(0).toUpperCase() + field.slice(1)}Manager();`,
        );
        continue;
      }

      if (!(managerInstance instanceof SyncedManager)) {
        console.warn(
          `[SyncedSession] '${field}' is not a SyncedManager instance.`,
        );
        continue;
      }

      // Initialize and get back the proxied manager
      const proxiedManager = initializeManager(managerInstance, this, field);

      // Replace the manager on the session with the proxied version
      (this as any)[field] = proxiedManager;

      // Register with session
      this._managers.set(field, proxiedManager);
    }
  }

  /** Get a manager by name */
  getManager<T extends SyncedManager>(name: string): T | undefined {
    this._ensureInitialized();
    return this._managers.get(name) as T | undefined;
  }

  /** Get all manager names */
  getManagerNames(): string[] {
    this._ensureInitialized();
    return Array.from(this._managers.keys());
  }

  /** Hydrate all managers from DB */
  async hydrate(): Promise<void> {
    this._ensureInitialized();
    if (this._hydrated) return;

    for (const mgr of this._managers.values()) {
      await mgr.hydrate();
    }

    this._hydrated = true;
  }

  /** Persist all managers to DB */
  async persist(): Promise<void> {
    this._ensureInitialized();
    for (const mgr of this._managers.values()) {
      await mgr.persist();
    }
  }

  /** Get full state snapshot */
  getSnapshot(): Record<string, any> {
    this._ensureInitialized();
    const snapshot: Record<string, any> = {
      userId: this.userId,
    };

    for (const [name, mgr] of this._managers) {
      snapshot[name] = mgr.getState();
    }

    return snapshot;
  }

  // ===========================================================================
  // Client Management
  // ===========================================================================

  /** Add a WebSocket client */
  addClient(ws: any): void {
    this._ensureInitialized();
    this._clients.add(ws);

    // Send initial state
    this._sendTo(ws, { type: "connected" });
    this._sendTo(ws, { type: "snapshot", state: this.getSnapshot() });

    console.log(
      `[Session] Client connected for ${this.userId} (total: ${this._clients.size})`,
    );
  }

  /** Remove a WebSocket client */
  removeClient(ws: any): void {
    this._clients.delete(ws);
    console.log(
      `[Session] Client disconnected for ${this.userId} (total: ${this._clients.size})`,
    );
  }

  /** Get number of connected clients */
  getClientCount(): number {
    return this._clients.size;
  }

  /** Send message to one client */
  private _sendTo(ws: any, message: WSMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (e) {
      this._clients.delete(ws);
    }
  }

  /** Broadcast message to all clients */
  private _broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this._clients) {
      try {
        ws.send(data);
      } catch (e) {
        this._clients.delete(ws);
      }
    }
  }

  /** Called by managers when synced property changes */
  broadcastStateChange(manager: string, property: string, value: any): void {
    this._broadcast({
      type: "state_change",
      manager,
      property,
      value,
    });
  }

  // ===========================================================================
  // RPC Handling
  // ===========================================================================

  /** Handle incoming WebSocket message */
  async handleMessage(ws: any, rawMessage: string): Promise<void> {
    try {
      const message = JSON.parse(rawMessage);

      if (message.type === "rpc_request") {
        await this._handleRPC(ws, message);
      } else if (message.type === "request_snapshot") {
        this._sendTo(ws, { type: "snapshot", state: this.getSnapshot() });
      }
    } catch (e) {
      console.error("[Session] Error handling message:", e);
    }
  }

  private async _handleRPC(
    ws: any,
    request: { id: string; manager: string; method: string; args: any[] },
  ): Promise<void> {
    const { id, manager: managerName, method, args } = request;

    try {
      const mgr = this._managers.get(managerName);
      if (!mgr) {
        throw new Error(`Unknown manager: ${managerName}`);
      }

      // Check if method is an RPC
      if (!mgr.getRPCMethods().includes(method)) {
        throw new Error(`Method not exposed: ${managerName}.${method}`);
      }

      const fn = (mgr as any)[method];
      if (typeof fn !== "function") {
        throw new Error(`Not a function: ${managerName}.${method}`);
      }

      const result = await fn.apply(mgr, args);

      this._sendTo(ws, { type: "rpc_response", id, result });
    } catch (e: any) {
      this._sendTo(ws, {
        type: "rpc_response",
        id,
        error: e.message || "RPC failed",
      });
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Dispose session — persist first, then destroy all managers */
  async dispose(): Promise<void> {
    await this.persist();
    for (const mgr of this._managers.values()) {
      mgr.destroy();
    }
    this._clients.clear();
  }
}

// =============================================================================
// SessionManager - Factory for sessions
// =============================================================================

/**
 * Manages session instances - one per user.
 *
 * @example
 * const sessions = new SessionManager(userId => new MySession(userId));
 *
 * // Get or create session
 * const session = await sessions.getOrCreate("user123");
 */
export class SessionManager<T extends SyncedSession = SyncedSession> {
  private _sessions: Map<string, T> = new Map();
  private _factory: (userId: string) => T;

  constructor(factory: (userId: string) => T) {
    this._factory = factory;
  }

  /** Get or create session for user */
  async getOrCreate(userId: string): Promise<T> {
    let session = this._sessions.get(userId);

    if (!session) {
      session = this._factory(userId);
      this._sessions.set(userId, session);
      await session.hydrate();
      const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      console.log(`[SessionManager] Created session for ${userId} (heap: ${memMB}MB, sessions: ${this._sessions.size})`);
    }

    return session;
  }

  /** Get existing session */
  get(userId: string): T | undefined {
    return this._sessions.get(userId);
  }

  /** Remove and dispose session */
  async remove(userId: string): Promise<void> {
    const session = this._sessions.get(userId);
    if (session) {
      await session.dispose();
      this._sessions.delete(userId);
      const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      console.log(`[SessionManager] Removed session for ${userId} (heap: ${memMB}MB, sessions: ${this._sessions.size})`);
    }
  }

  /** Get all active user IDs */
  getActiveUserIds(): string[] {
    return Array.from(this._sessions.keys());
  }

  /** Get count of active sessions */
  getActiveCount(): number {
    return this._sessions.size;
  }
}

// =============================================================================
// Exports
// =============================================================================

export { unwrapSynced, isSynced, createSynced };
