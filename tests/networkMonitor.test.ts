import { NetworkMonitor } from "../src/networkMonitor";

describe("NetworkMonitor", () => {
  it("starts offline by default", () => {
    const monitor = new NetworkMonitor();
    expect(monitor.isOnline).toBe(false);
  });

  it("setOnline(true) emits 'online' and 'change' events", (done) => {
    const monitor = new NetworkMonitor();
    const events: string[] = [];
    monitor.on("online", () => events.push("online"));
    monitor.on("change", (v: boolean) => events.push(`change:${v}`));
    monitor.setOnline(true);
    setImmediate(() => {
      expect(events).toContain("online");
      expect(events).toContain("change:true");
      done();
    });
  });

  it("setOnline(false) emits 'offline' event", (done) => {
    const monitor = new NetworkMonitor();
    monitor.setOnline(true); // start online
    monitor.on("offline", () => {
      expect(monitor.isOnline).toBe(false);
      done();
    });
    monitor.setOnline(false);
  });

  it("does not emit duplicate events for same state", () => {
    const monitor = new NetworkMonitor();
    const events: string[] = [];
    monitor.on("online", () => events.push("online"));
    monitor.setOnline(true);
    monitor.setOnline(true); // duplicate – should not fire again
    expect(events).toHaveLength(1);
  });

  it("stop() prevents further polling", (done) => {
    let checkCount = 0;
    const monitor = new NetworkMonitor({
      pollIntervalMs: 50,
      checker: async () => {
        checkCount++;
        return true;
      },
    });
    monitor.start();
    setTimeout(() => {
      monitor.stop();
      const countAtStop = checkCount;
      setTimeout(() => {
        // Should not have increased after stop
        expect(checkCount).toBe(countAtStop);
        done();
      }, 150);
    }, 80);
  });

  it("uses injected checker to determine connectivity", (done) => {
    const monitor = new NetworkMonitor({
      pollIntervalMs: 50,
      checker: async () => true,
    });
    monitor.on("online", () => {
      expect(monitor.isOnline).toBe(true);
      monitor.stop();
      done();
    });
    monitor.start();
  });

  it("marks offline when checker throws", (done) => {
    const monitor = new NetworkMonitor({
      pollIntervalMs: 50,
      checker: async () => { throw new Error("net error"); },
    });
    monitor.setOnline(true); // force online first
    monitor.on("offline", () => {
      expect(monitor.isOnline).toBe(false);
      monitor.stop();
      done();
    });
    monitor.start();
  });
});
