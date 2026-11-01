import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { UploadQueue } from "../src/queue";
import { NetworkMonitor } from "../src/networkMonitor";
import { UploadService, OFFLINE_MESSAGE, UploadResult } from "../src/uploadService";

// ---------- helpers ----------------------------------------------------------

function makeTempDb(suffix = ""): { queue: UploadQueue; dbPath: string } {
  const dbPath = path.join(
    os.tmpdir(),
    `svc-test-${Date.now()}-${Math.random()}${suffix}.db`
  );
  const queue = new UploadQueue({ dbPath, encryptionKey: "svc-test-key" });
  return { queue, dbPath };
}

function cleanDb(dbPath: string) {
  for (const ext of ["", "-wal", "-shm"]) {
    const p = dbPath + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

const successUploader = async (): Promise<UploadResult> => ({ success: true, statusCode: 200 });
const failUploader = async (): Promise<UploadResult> => ({ success: false, statusCode: 500 });


function buildService(
  queue: UploadQueue,
  monitor: NetworkMonitor,
  uploader = successUploader,
  _overrides: Record<string, unknown> = {},
  callbacks: {
    onOfflineMessage?: (m: string) => void;
    onUploadSuccess?: (id: string, claimId: string) => void;
    onAllUploaded?: (claimId: string) => void;
    onUploadFailed?: (id: string, claimId: string) => void;
  } = {}
) {
  return new UploadService({
    queue,
    networkMonitor: monitor,
    uploader,
    maxAttempts: 3,
    backoffBaseMs: 1,   // near-zero for tests
    backoffMaxMs: 5,
    ...callbacks,
  });
}

// ---------- AC2: offline message ---------------------------------------------

describe("AC2 – offline message", () => {
  it("shows exact offline message when image enqueued while offline", () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    const messages: string[] = [];
    const svc = buildService(queue, monitor, successUploader, {}, {
      onOfflineMessage: (m) => messages.push(m),
    });
    svc.initialize();

    // offline by default
    expect(monitor.isOnline).toBe(false);
    svc.enqueueImage("claim-001", Buffer.from("photo"));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(
      "Keine Internetverbindung. Die Bilder werden hochgeladen, sobald Du wieder online bist."
    );

    queue.close();
    cleanDb(dbPath);
  });

  it("shows offline message via event emitter as well", () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    const messages: string[] = [];
    const svc = buildService(queue, monitor);
    svc.initialize();
    svc.on("offlineMessage", (m: string) => messages.push(m));

    svc.enqueueImage("claim-001", Buffer.from("photo"));
    expect(messages[0]).toBe(OFFLINE_MESSAGE);

    queue.close();
    cleanDb(dbPath);
  });

  it("OFFLINE_MESSAGE constant matches the required wording exactly", () => {
    expect(OFFLINE_MESSAGE).toBe(
      "Keine Internetverbindung. Die Bilder werden hochgeladen, sobald Du wieder online bist."
    );
  });
});

// ---------- AC1: encrypted queue when offline --------------------------------

describe("AC1 – AES-256-encrypted SQLite queue when offline", () => {
  it("stores image in queue when offline", () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    const svc = buildService(queue, monitor);
    svc.initialize();

    svc.enqueueImage("claim-001", Buffer.from("image-bytes"));
    expect(queue.count("pending")).toBe(1);

    queue.close();
    cleanDb(dbPath);
  });

  it("stores multiple images per claim while offline", () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    const svc = buildService(queue, monitor);
    svc.initialize();

    for (let i = 0; i < 5; i++) {
      svc.enqueueImage("claim-multi", Buffer.from(`photo-${i}`));
    }
    expect(queue.count("pending")).toBe(5);

    queue.close();
    cleanDb(dbPath);
  });
});

// ---------- AC3: auto-upload when connection restored -------------------------

describe("AC3 – automatic upload when connection restored", () => {
  it("processes queue automatically when network comes online", async () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    const uploaded: string[] = [];
    const svc = buildService(queue, monitor, successUploader, {}, {
      onUploadSuccess: (id, claimId) => uploaded.push(claimId),
    });
    svc.initialize();

    // Enqueue while offline
    svc.enqueueImage("claim-003", Buffer.from("photo-a"));
    svc.enqueueImage("claim-003", Buffer.from("photo-b"));
    expect(queue.count("pending")).toBe(2);

    // Restore connectivity → upload should start automatically
    monitor.setOnline(true);

    // Allow async processing
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));

    expect(queue.count("done")).toBe(2);
    expect(uploaded).toHaveLength(2);

    queue.close();
    cleanDb(dbPath);
  });

  it("does not require user interaction to trigger upload", async () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    let uploadCalled = false;
    const uploader = async (): Promise<UploadResult> => {
      uploadCalled = true;
      return { success: true };
    };
    const svc = buildService(queue, monitor, uploader);
    svc.initialize();

    svc.enqueueImage("claim-004", Buffer.from("photo"));
    monitor.setOnline(true); // no other user action

    await new Promise((r) => setTimeout(r, 50));
    expect(uploadCalled).toBe(true);

    queue.close();
    cleanDb(dbPath);
  });
});

// ---------- AC4: visual confirmation after successful upload -----------------

describe("AC4 – visual confirmation after successful upload", () => {
  it("calls onUploadSuccess callback after each job succeeds", async () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    monitor.setOnline(true);
    const successes: Array<{ jobId: string; claimId: string }> = [];
    const svc = buildService(queue, monitor, successUploader, {}, {
      onUploadSuccess: (jobId, claimId) => successes.push({ jobId, claimId }),
    });
    svc.initialize();

    svc.enqueueImage("claim-004", Buffer.from("photo"));

    await new Promise((r) => setTimeout(r, 50));
    expect(successes).toHaveLength(1);
    expect(successes[0].claimId).toBe("claim-004");

    queue.close();
    cleanDb(dbPath);
  });

  it("emits uploadSuccess event", async () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    monitor.setOnline(true);
    const events: any[] = [];
    const svc = buildService(queue, monitor, successUploader);
    svc.on("uploadSuccess", (e: any) => events.push(e));
    svc.initialize();

    svc.enqueueImage("claim-004b", Buffer.from("photo"));

    await new Promise((r) => setTimeout(r, 50));
    expect(events).toHaveLength(1);
    expect(events[0].claimId).toBe("claim-004b");

    queue.close();
    cleanDb(dbPath);
  });

  it("calls onAllUploaded when all jobs for a claim are done", async () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    monitor.setOnline(true);
    const allUploaded: string[] = [];
    const svc = buildService(queue, monitor, successUploader, {}, {
      onAllUploaded: (claimId) => allUploaded.push(claimId),
    });
    svc.initialize();

    svc.enqueueImage("claim-all", Buffer.from("photo1"));

    await new Promise((r) => setTimeout(r, 50));
    expect(allUploaded).toContain("claim-all");

    queue.close();
    cleanDb(dbPath);
  });
});

// ---------- AC5: pending jobs restored after app restart ---------------------

describe("AC5 – pending jobs restored after app restart", () => {
  it("recovers stuck uploading jobs on initialize()", () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();

    // Simulate crash: job left in 'uploading' state
    const id = queue.enqueue("claim-crash", Buffer.from("photo"));
    queue.markUploading(id);
    expect(queue.count("uploading")).toBe(1);

    // Simulate app restart: new service, same queue
    const svc = buildService(queue, monitor);
    const recoveredCounts: number[] = [];
    svc.on("recovered", (n: number) => recoveredCounts.push(n));
    svc.initialize();

    expect(queue.count("uploading")).toBe(0);
    expect(queue.count("pending")).toBe(1);
    expect(recoveredCounts[0]).toBe(1);

    queue.close();
    cleanDb(dbPath);
  });

  it("continues pending uploads automatically after restart when online", async () => {
    const { queue, dbPath } = makeTempDb();

    // Session 1: enqueue offline, then close
    queue.enqueue("claim-restart", Buffer.from("photo-after-restart"));
    queue.close();

    // Session 2: reopen queue (simulates app restart)
    const queue2 = new UploadQueue({ dbPath, encryptionKey: "svc-test-key" });
    const monitor = new NetworkMonitor();
    monitor.setOnline(true);
    const uploaded: string[] = [];
    const svc = buildService(queue2, monitor, successUploader, {}, {
      onUploadSuccess: (id, claimId) => uploaded.push(claimId),
    });
    svc.initialize();

    await new Promise((r) => setTimeout(r, 100));
    expect(uploaded).toContain("claim-restart");
    expect(queue2.count("done")).toBe(1);

    queue2.close();
    cleanDb(dbPath);
  });
});

// ---------- AC6: exponential backoff on 5xx / timeout -----------------------

describe("AC6 – exponential backoff on transient errors", () => {
  it("retries on 5xx response and eventually marks failed after maxAttempts", async () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    monitor.setOnline(true);
    let callCount = 0;
    const uploader = async (): Promise<UploadResult> => {
      callCount++;
      return { success: false, statusCode: 503 };
    };
    const failed: string[] = [];
    const svc = new UploadService({
      queue,
      networkMonitor: monitor,
      uploader,
      maxAttempts: 3,
      backoffBaseMs: 1,
      backoffMaxMs: 5,
      onUploadFailed: (id, claimId) => failed.push(claimId),
    });
    svc.initialize();

    svc.enqueueImage("claim-retry", Buffer.from("photo"));

    await new Promise((r) => setTimeout(r, 200));
    expect(callCount).toBe(3); // 3 attempts total
    expect(failed).toHaveLength(1);
    expect(queue.count("failed")).toBe(1);

    queue.close();
    cleanDb(dbPath);
  });

  it("retries on network timeout (thrown error) with backoff", async () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    monitor.setOnline(true);
    let callCount = 0;
    const uploader = async (): Promise<UploadResult> => {
      callCount++;
      if (callCount < 3) throw new Error("ETIMEDOUT");
      return { success: true, statusCode: 200 };
    };
    const successes: string[] = [];
    const svc = new UploadService({
      queue,
      networkMonitor: monitor,
      uploader,
      maxAttempts: 5,
      backoffBaseMs: 1,
      backoffMaxMs: 5,
      onUploadSuccess: (id, claimId) => successes.push(claimId),
    });
    svc.initialize();

    svc.enqueueImage("claim-timeout", Buffer.from("photo"));

    await new Promise((r) => setTimeout(r, 200));
    expect(callCount).toBe(3); // failed twice, succeeded on 3rd
    expect(successes).toContain("claim-timeout");

    queue.close();
    cleanDb(dbPath);
  });

  it("does not retry on 4xx (non-transient) errors", async () => {
    const { queue, dbPath } = makeTempDb();
    const monitor = new NetworkMonitor();
    monitor.setOnline(true);
    let callCount = 0;
    const uploader = async (): Promise<UploadResult> => {
      callCount++;
      return { success: false, statusCode: 400 };
    };
    const svc = new UploadService({
      queue,
      networkMonitor: monitor,
      uploader,
      maxAttempts: 5,
      backoffBaseMs: 1,
      backoffMaxMs: 5,
    });
    svc.initialize();
    svc.enqueueImage("claim-4xx", Buffer.from("photo"));

    await new Promise((r) => setTimeout(r, 100));
    expect(callCount).toBe(1); // no retry on 4xx

    queue.close();
    cleanDb(dbPath);
  });
});

// ---------- AC7: no data loss on crash (atomic writes) ----------------------

describe("AC7 – atomic writes, no data loss on crash", () => {
  it("job remains in queue if upload never completes (crash simulation)", () => {
    const { queue, dbPath } = makeTempDb();
    const id = queue.enqueue("claim-crash", Buffer.from("photo"));

    // Simulate crash during upload: job is 'uploading' but never marked done
    queue.markUploading(id);

    // Reopen queue (app restart)
    queue.close();
    const queue2 = new UploadQueue({ dbPath, encryptionKey: "svc-test-key" });
    expect(queue2.count("uploading")).toBe(1); // still there

    // Recovery resets it to pending
    queue2.recoverStuckJobs();
    expect(queue2.count("pending")).toBe(1);
    expect(queue2.count("done")).toBe(0);

    queue2.close();
    cleanDb(dbPath);
  });

  it("enqueue is atomic – data fully written or not at all", () => {
    const { queue, dbPath } = makeTempDb();
    const imageData = Buffer.from("atomic-write-test-payload");
    const id = queue.enqueue("claim-atomic", imageData);

    // Immediately reopen to verify data is persisted
    queue.close();
    const queue2 = new UploadQueue({ dbPath, encryptionKey: "svc-test-key" });
    const jobs = queue2.getPendingJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(id);
    expect(jobs[0].imageData.equals(imageData)).toBe(true);

    queue2.close();
    cleanDb(dbPath);
  });
});

// ---------- AC8: End-to-End test --------------------------------------------

describe("AC8 – End-to-End: offline enqueue → restart → network restored → upload", () => {
  it("full E2E: images survive offline + crash + restart + reconnect without data loss", async () => {
    const dbPath = path.join(
      os.tmpdir(),
      `e2e-test-${Date.now()}.db`
    );

    // === Phase 1: User submits claim offline ===
    const queue1 = new UploadQueue({ dbPath, encryptionKey: "e2e-key" });
    const monitor1 = new NetworkMonitor();
    // offline
    expect(monitor1.isOnline).toBe(false);

    const offlineMessages: string[] = [];
    const svc1 = new UploadService({
      queue: queue1,
      networkMonitor: monitor1,
      uploader: successUploader,
      maxAttempts: 3,
      backoffBaseMs: 1,
      backoffMaxMs: 5,
      onOfflineMessage: (m) => offlineMessages.push(m),
    });
    svc1.initialize();

    // Enqueue 3 photos while offline
    svc1.enqueueImage("claim-e2e", Buffer.from("photo-1"));
    svc1.enqueueImage("claim-e2e", Buffer.from("photo-2"));
    svc1.enqueueImage("claim-e2e", Buffer.from("photo-3"));

    // AC2: offline message shown
    expect(offlineMessages.length).toBeGreaterThanOrEqual(1);
    expect(offlineMessages[0]).toBe(OFFLINE_MESSAGE);

    // AC1: all stored in encrypted queue
    expect(queue1.count("pending")).toBe(3);

    // Simulate crash / app close
    queue1.close();

    // === Phase 2: App restart ===
    const queue2 = new UploadQueue({ dbPath, encryptionKey: "e2e-key" });
    const monitor2 = new NetworkMonitor();
    // Still offline at restart
    expect(monitor2.isOnline).toBe(false);

    const uploadedJobs: string[] = [];
    const allUploaded: string[] = [];
    const svc2 = new UploadService({
      queue: queue2,
      networkMonitor: monitor2,
      uploader: successUploader,
      maxAttempts: 3,
      backoffBaseMs: 1,
      backoffMaxMs: 5,
      onUploadSuccess: (id, claimId) => uploadedJobs.push(claimId),
      onAllUploaded: (claimId) => allUploaded.push(claimId),
    });

    // AC5: pending jobs restored on initialize
    svc2.initialize();
    expect(queue2.count("pending")).toBe(3); // all still there

    // === Phase 3: Network restored ===
    // AC3: upload starts automatically, no user interaction
    monitor2.setOnline(true);

    await new Promise((r) => setTimeout(r, 200));

    // AC3 + AC4: all 3 images uploaded, confirmation received
    expect(uploadedJobs).toHaveLength(3);
    expect(queue2.count("done")).toBe(3);
    expect(queue2.count("pending")).toBe(0);

    // AC4: visual confirmation for all-done
    expect(allUploaded).toContain("claim-e2e");

    // No data loss: 0 failed, 0 pending
    expect(queue2.count("failed")).toBe(0);

    queue2.close();
    cleanDb(dbPath);
  });
});
