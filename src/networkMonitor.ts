/**
 * NetworkMonitor – polls connectivity and emits 'online' / 'offline' events.
 *
 * In a real React Native app this would wrap @react-native-community/netinfo.
 * Here we provide a testable interface with a pluggable connectivity check function.
 */

import { EventEmitter } from "events";

export type ConnectivityChecker = () => Promise<boolean>;

export interface NetworkMonitorOptions {
  /** How often to poll (ms). Default 5000. */
  pollIntervalMs?: number;
  /** Injectable connectivity checker. Defaults to a simple HEAD request. */
  checker?: ConnectivityChecker;
}

export class NetworkMonitor extends EventEmitter {
  private _online: boolean = false;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _pollIntervalMs: number;
  private _checker: ConnectivityChecker;
  private _running: boolean = false;

  constructor(options: NetworkMonitorOptions = {}) {
    super();
    this._pollIntervalMs = options.pollIntervalMs ?? 5000;
    this._checker = options.checker ?? defaultChecker;
  }

  get isOnline(): boolean {
    return this._online;
  }

  /** Start polling. */
  start(): void {
    if (this._running) return;
    this._running = true;
    // immediate first check
    this._check();
    this._timer = setInterval(() => this._check(), this._pollIntervalMs);
  }

  /** Stop polling. */
  stop(): void {
    this._running = false;
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Manually set online state (used by tests and React Native bridge).
   * Fires events only when state actually changes.
   */
  setOnline(value: boolean): void {
    if (value === this._online) return;
    this._online = value;
    this.emit(value ? "online" : "offline");
    this.emit("change", value);
  }

  private async _check(): Promise<void> {
    try {
      const result = await this._checker();
      this.setOnline(result);
    } catch {
      this.setOnline(false);
    }
  }
}

/** Default checker: try to reach a well-known endpoint. */
const defaultChecker: ConnectivityChecker = async () => {
  try {
    // In Node.js environment; in RN this would be replaced by NetInfo
    const { default: fetch } = await import("node-fetch");
    const res = await fetch("https://www.google.com", {
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
};
