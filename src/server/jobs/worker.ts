import { PermanentJobError, type Handler, type Queue } from "./types";

export type WorkerSummary = { claimed: number; done: number; retried: number; dead: number; released: number; lostLease: number; byType: Record<string, number> };

/**
 * Processes queued jobs until the queue is empty or the time budget is spent.
 * Leases are sized to the budget, so a crashed or timed-out run simply lets the
 * lease expire and the next run picks the job up again.
 */
export async function runWorker(
  queue: Queue,
  handlers: Record<string, Handler>,
  opts: { workerId: string; budgetMs: number; batchSize?: number; now?: () => number; log?: (event: string, fields: Record<string, unknown>) => void },
): Promise<WorkerSummary> {
  const now = opts.now ?? Date.now;
  const started = now();
  const lease = Math.ceil(opts.budgetMs / 1000) + 60;
  const s: WorkerSummary = { claimed: 0, done: 0, retried: 0, dead: 0, released: 0, lostLease: 0, byType: {} };
  const log = opts.log ?? (() => {});

  while (now() - started < opts.budgetMs) {
    const jobs = await queue.claim(opts.workerId, opts.batchSize ?? 5, lease);
    if (!jobs.length) break;
    s.claimed += jobs.length;

    for (const job of jobs) {
      if (now() - started >= opts.budgetMs) {
        // Out of time: hand unstarted jobs straight back for the next run.
        await queue.release(job.id, opts.workerId);
        s.released++;
        continue;
      }
      s.byType[job.job_type] = (s.byType[job.job_type] ?? 0) + 1;
      const handler = handlers[job.job_type];
      let outcome: "retry" | "dead" | "lost_lease" | "done";
      try {
        if (!handler) throw new PermanentJobError(`no handler for job type "${job.job_type}"`);
        const r = await handler(job);
        if (r.kind === "done") outcome = (await queue.complete(job.id, opts.workerId)) ? "done" : "lost_lease";
        else if (r.kind === "retry") outcome = await queue.fail(job.id, opts.workerId, r.reason, { retryAt: r.at });
        else outcome = await queue.fail(job.id, opts.workerId, r.reason, { permanent: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outcome = await queue.fail(job.id, opts.workerId, message.slice(0, 500), { permanent: err instanceof PermanentJobError });
        log("job.error", { job_id: job.id, job_type: job.job_type, attempts: job.attempts, outcome, error: message.slice(0, 200) });
      }
      if (outcome === "done") s.done++;
      else if (outcome === "retry") s.retried++;
      else if (outcome === "dead") s.dead++;
      else s.lostLease++;
      if (outcome === "dead") log("job.dead", { job_id: job.id, job_type: job.job_type, attempts: job.attempts });
    }
  }
  return s;
}
