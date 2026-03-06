/**
 * useSynced - React hook for synced state
 *
 * Connects to backend via WebSocket and returns a typed session object.
 *
 * @example
 * const session = useSynced<SessionI>(userId);
 *
 * session.notes.notes           // State (auto-updates)
 * session.notes.createNote()    // RPC (returns Promise)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { WSMessageToClient, WSMessageToServer } from "../../shared/types";

// =============================================================================
// SyncClient
// =============================================================================

class SyncClient<T> {
  private ws: WebSocket | null = null;
  private state: Record<string, any> = {};
  private pendingRPCs: Map<string, { resolve: Function; reject: Function }> =
    new Map();
  private rpcIdCounter = 0;
  private listeners: Set<() => void> = new Set();
  private _isConnected = false;
  private userId: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _version = 0;
  private _notifyScheduled = false;

  constructor(userId: string) {
    this.userId = userId;
    this.connect();
  }

  private connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/sync?userId=${encodeURIComponent(this.userId)}`;

    console.log("[Synced] Connecting...");
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("[Synced] Connected");
      this._isConnected = true;
      this._version++;
      this.notifyListeners();
    };

    this.ws.onclose = () => {
      console.log("[Synced] Disconnected");
      this._isConnected = false;
      this._version++;
      this.notifyListeners();

      // Auto-reconnect
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = (error) => {
      console.error("[Synced] Error:", error);
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(JSON.parse(event.data));
    };
  }

  private handleMessage(message: WSMessageToClient): void {
    switch (message.type) {
      case "connected":
        console.log("[Synced] Session ready");
        this._version++;
        this.notifyListeners();
        break;

      case "snapshot":
        console.log("[Synced] Snapshot received");
        this.state = message.state;
        this._version++;
        this.notifyListeners();
        // Auto-detect and sync user timezone on connection
        this.syncTimezone();
        break;

      case "state_change":
        console.log(
          `[Synced] state_change: ${message.manager}.${message.property} =`,
          message.value,
        );
        // For session-level state (hasGlassesConnected, isRecording, etc.),
        // store at top level to match snapshot format
        if (message.manager === "session") {
          this.state[message.property] = message.value;
        } else {
          if (!this.state[message.manager]) {
            this.state[message.manager] = {};
          }
          this.state[message.manager] = {
            ...this.state[message.manager],
            [message.property]: message.value,
          };
        }
        // Batched: coalesces rapid sequential state changes (e.g. interimText=""
        // + segments=[...]) into a single React re-render to prevent layout jumps
        this.scheduleNotify();
        break;

      case "rpc_response":
        const pending = this.pendingRPCs.get(message.id);
        if (pending) {
          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message.result);
          }
          this.pendingRPCs.delete(message.id);
        }
        break;
    }
  }

  /**
   * Auto-detect and sync the user's local timezone to the backend.
   * Runs on every connection/reconnection to keep it up to date.
   */
  private syncTimezone(): void {
    try {
      const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!localTimezone) return;

      const savedTimezone = this.state?.settings?.timezone;
      if (savedTimezone === localTimezone) return; // Already correct

      console.log(
        `[Synced] Syncing timezone: ${savedTimezone ?? "unset"} -> ${localTimezone}`,
      );
      this.callRPC("settings", "updateSettings", [
        { timezone: localTimezone },
      ]).catch((err) => {
        console.error("[Synced] Failed to sync timezone:", err);
      });
    } catch {
      // Intl API not available, skip
    }
  }

  callRPC(manager: string, method: string, args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected"));
        return;
      }

      const id = String(++this.rpcIdCounter);
      this.pendingRPCs.set(id, { resolve, reject });

      const message: WSMessageToServer = {
        type: "rpc_request",
        id,
        manager,
        method,
        args,
      };

      this.ws.send(JSON.stringify(message));
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Schedule a batched notify — coalesces multiple state_change messages
   * that arrive in the same microtask into a single React re-render.
   * This prevents layout jumping when the backend sends e.g. interimText=""
   * and segments=[...] as two rapid broadcasts for the same event.
   */
  private scheduleNotify(): void {
    this._version++;
    if (this._notifyScheduled) return;
    this._notifyScheduled = true;
    queueMicrotask(() => {
      this._notifyScheduled = false;
      this.notifyListeners();
    });
  }

  reconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.connect();
  }

  dispose(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.listeners.clear();
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get currentState(): Record<string, any> {
    return this.state;
  }

  get version(): number {
    return this._version;
  }
}

// =============================================================================
// Client Cache
// =============================================================================

const clientCache = new Map<string, SyncClient<any>>();

// =============================================================================
// Hook
// =============================================================================

export interface UseSyncedResult<T> {
  session: T | null;
  isConnected: boolean;
  reconnect: () => void;
}

/**
 * React hook that connects to backend and returns a typed session.
 *
 * @param userId - The user ID to connect as
 * @returns Session object with synced state and RPC methods
 */
export function useSynced<T>(userId: string): UseSyncedResult<T> {
  const clientRef = useRef<SyncClient<T> | null>(null);
  const [version, setVersion] = useState(0);

  // Get or create client (only if userId is provided)
  if (userId && !clientRef.current) {
    let client = clientCache.get(userId);
    if (!client) {
      client = new SyncClient<T>(userId);
      clientCache.set(userId, client);
    }
    clientRef.current = client;
  }

  const client = clientRef.current;

  // Subscribe to client updates
  useEffect(() => {
    if (!client) return;

    const unsubscribe = client.subscribe(() => {
      setVersion(client.version);
    });
    return unsubscribe;
  }, [client]);

  // Build session proxy
  const session = useMemo((): T | null => {
    if (!client) return null;

    const state = client.currentState;
    if (!state || Object.keys(state).length === 0) {
      return null;
    }

    // Create proxy that provides typed access to state and RPCs
    return new Proxy({} as object, {
      get(target, prop: string) {
        // Ignore React DevTools internal checks
        if (
          prop === "$$typeof" ||
          prop === "_owner" ||
          prop === "_store" ||
          typeof prop === "symbol"
        ) {
          return undefined;
        }

        // Top-level session state (userId, hasGlassesConnected, etc.)
        if (prop in state && typeof state[prop] !== "object") {
          return state[prop];
        }

        // Manager access - return a proxy for the manager
        const managerState = state[prop];
        if (managerState === undefined) {
          return undefined;
        }

        // If it's a primitive at top level, return it directly
        if (typeof managerState !== "object" || managerState === null) {
          return managerState;
        }

        // Return proxy for manager object
        return new Proxy(
          {},
          {
            get(target, managerProp: string) {
              // Ignore React DevTools internal checks
              if (
                managerProp === "$$typeof" ||
                managerProp === "_owner" ||
                managerProp === "_store" ||
                typeof managerProp === "symbol"
              ) {
                return undefined;
              }

              // If property exists in state, return it
              if (managerProp in managerState) {
                return managerState[managerProp];
              }

              // Otherwise it's an RPC call
              return (...args: any[]) =>
                client.callRPC(prop, managerProp, args);
            },
          },
        );
      },
    }) as T;
  }, [client, version]);

  // Reconnect callback
  const reconnect = useCallback(() => {
    if (client) {
      client.reconnect();
    }
  }, [client]);

  return {
    session,
    isConnected: client?.isConnected ?? false,
    reconnect,
  };
}

/**
 * Disconnect and cleanup a session client.
 */
export function disconnectSynced(userId: string): void {
  const client = clientCache.get(userId);
  if (client) {
    client.dispose();
    clientCache.delete(userId);
  }
}
