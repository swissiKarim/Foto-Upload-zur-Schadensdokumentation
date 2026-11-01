import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { UploadQueue } from "../src/queue";

function makeTempDb(): { queue: UploadQueue; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `test-queue-${Date.now()}-${Math.random()}.db`);
  const queue = new UploadQueue({ dbPath, encryptionKey: "unit-test-key" });
  return { queue, dbPath };
}

describe("UploadQueue – AES-256 encrypted SQLite persistence", () => {
  let queue: UploadQueue;
  let dbPath: string;

  beforeEach(() => {
    ({ queue, dbPath } = makeTempDb());
  });

  afterEach(() => {
    queue.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const walPath = dbPath + "-wal";
    const shmPath = dbPath + "-shm";
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  });

  // AC1: images stored in AES-256-encrypted SQLite queue when offline
  it("AC1 – enqueues an image and stores it encrypted in SQLite", () => {
    const imageData = Buffer.from("fake-jpeg-bytes");
    const id = queue.enqueue("claim-001", imageData);

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(queue.count("pending")).toBe(1);
  });

  it("AC1 – payload on disk is encrypted (not plaintext)", () => {
    const imageData = Buffer.from("super-secret-photo-bytes");
    queue.enqueue("claim-001", imageData);

    // Read raw bytes from SQLite file – they must NOT contain the plaintext
    const raw = fs.readFileSync(dbPath);
    expect(raw.includes(imageData)).toBe(false);
  });

  it("AC1 – decrypts data correctly on retrieval", () => {
    const imageData = Buffer.from("photo-payload-123");
    queue.enqueue("claim-002", imageData);
    const jobs = queue.getByStatus("pending");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].imageData.equals(imageData)).toBe(true);
    expect(jobs[0].claimId).toBe("claim-002");
  });

  it("enqueues multiple images and returns them in insertion order", () => {
    const imgs = ["img1", "img2", "img3"].map((s) => Buffer.from(s));
    imgs.forEach((b, i) => queue.enqueue(`claim-${i}`, b));
    const jobs = queue.getPendingJobs();
    expect(jobs).toHaveLength(3);
    jobs.forEach((j, i) => expect(j.imageData.toString()).toBe(`img${i + 1}`));
  });

  it("markUploading transitions status from pending to uploading", () => {
    const id = queue.enqueue("claim-001", Buffer.from("x"));
    queue.markUploading(id);
    expect(queue.count("uploading")).toBe(1);
    expect(queue.count("pending")).toBe(0);
  });

  it("markDone removes job from pending set", () => {
    const id = queue.enqueue("claim-001", Buffer.from("x"));
    queue.markUploading(id);
    queue.markDone(id);
    expect(queue.count("done")).toBe(1);
    expect(queue.count("pending")).toBe(0);
  });

  // AC6: exponential backoff – retry counter incremented
  it("AC6 – markRetry increments attempts and keeps pending if below maxAttempts", () => {
    const id = queue.enqueue("claim-001", Buffer.from("x"));
    queue.markUploading(id);
    queue.markRetry(id, 5);
    const jobs = queue.getByStatus("pending");
    expect(jobs[0].attempts).toBe(1);
    expect(jobs[0].status).toBe("pending");
  });

  it("AC6 – markRetry marks job as failed when maxAttempts reached", () => {
    const id = queue.enqueue("claim-001", Buffer.from("x"));
    queue.markUploading(id);
    // simulate 4 prior attempts
    for (let i = 0; i < 4; i++) {
      queue.markRetry(id, 5);
      if (i < 3) queue.markUploading(id); // reset to uploading for next retry
    }
    queue.markRetry(id, 5);
    expect(queue.count("failed")).toBe(1);
  });

  // AC5 + AC7: crash recovery
  it("AC5/AC7 – recoverStuckJobs resets uploading→pending (crash recovery)", () => {
    const id = queue.enqueue("claim-001", Buffer.from("x"));
    queue.markUploading(id);
    expect(queue.count("uploading")).toBe(1);

    const recovered = queue.recoverStuckJobs();
    expect(recovered).toBe(1);
    expect(queue.count("uploading")).toBe(0);
    expect(queue.count("pending")).toBe(1);
  });

  // AC7: data survives close/reopen (persistence)
  it("AC7 – data persists across queue close and reopen", () => {
    const imageData = Buffer.from("persistent-photo");
    queue.enqueue("claim-persist", imageData);
    queue.close();

    const queue2 = new UploadQueue({ dbPath, encryptionKey: "unit-test-key" });
    const jobs = queue2.getPendingJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].imageData.equals(imageData)).toBe(true);
    queue2.close();
  });

  it("count() returns total without filter", () => {
    queue.enqueue("claim-001", Buffer.from("a"));
    queue.enqueue("claim-001", Buffer.from("b"));
    expect(queue.count()).toBe(2);
  });

  it("remove() deletes a job", () => {
    const id = queue.enqueue("claim-001", Buffer.from("x"));
    queue.remove(id);
    expect(queue.count()).toBe(0);
  });
});
