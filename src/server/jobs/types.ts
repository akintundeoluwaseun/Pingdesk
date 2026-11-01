export type Job = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  user_id: string | null;
  attempts: number;
  max_attempts: number;
};

export interface Queue {
  claim(worker: string, limit: number, leaseSeconds: number): Promise<Job[]>;
  complete(jobId: string, worker: string): Promise<boolean>;
  /** Return an unstarted job to the queue without counting an attempt. */
  release(jobId: string, worker: string): Promise<boolean>;
  fail(jobId: string, worker: string, error: string, opts?: { retryAt?: Date | null; permanent?: boolean }): Promise<"retry" | "dead" | "lost_lease">;
}

/** What a handler wants done with its job. */
export type HandlerResult = { kind: "done" } | { kind: "retry"; at: Date; reason: string } | { kind: "dead"; reason: string };

export type Handler = (job: Job) => Promise<HandlerResult>;

export class PermanentJobError extends Error {}
