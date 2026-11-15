import {
  appendAuditEvent,
  computeNextRunIso,
  readAdvancedStore,
  writeAdvancedStore,
} from './store';
import { enqueueAnalysisJob } from './pipeline';

let schedulerHandle: NodeJS.Timeout | null = null;
let tickInProgress = false;

export async function runSchedulerTick(nowMs = Date.now()): Promise<{
  checked: number;
  triggeredJobIds: string[];
}> {
  if (tickInProgress) return { checked: 0, triggeredJobIds: [] };
  tickInProgress = true;
  const triggeredJobIds: string[] = [];

  try {
    const store = readAdvancedStore();
    const schedules = store.schedules;
    let mutated = false;

    for (let i = 0; i < schedules.length; i++) {
      const sched = schedules[i];

      // Strict durability & consent enforcement: NEVER run paused or consent-revoked schedules!
      if (
        !sched.enabled ||
        sched.status !== 'active' ||
        !sched.consent.allowRemoteJobProcessing ||
        !sched.consent.allowRemoteProviderRequests
      ) {
        continue;
      }

      const nextMs = Date.parse(sched.nextRunAt);
      if (!Number.isFinite(nextMs) || nowMs < nextMs) {
        continue;
      }

      // Compute slot-level idempotency key so duplicate timer fires can never double-run
      const slotKey = `sched:${sched.id}:${sched.nextRunAt.slice(0, 13)}`;
      const alreadyQueued = store.jobs.some((j) => j.idempotencyKey === slotKey);
      if (alreadyQueued) {
        continue;
      }

      const nextNextRunAt = computeNextRunIso(
        sched.frequency,
        sched.preferredTime,
        sched.timezone,
        nowMs
      );

      // Update schedule nextRunAt BEFORE enqueuing to guarantee no duplicate ticks
      store.schedules[i] = {
        ...sched,
        lastRunAt: new Date(nowMs).toISOString(),
        nextRunAt: nextNextRunAt,
        updatedAt: new Date(nowMs).toISOString(),
      };
      mutated = true;
      writeAdvancedStore(store);

      const { job } = enqueueAnalysisJob({
        farmId: sched.farmId,
        scope: sched.scope,
        runType: 'scheduled',
        triggerReason: `Automated ${sched.frequency} schedule (${sched.name})`,
        idempotencyKey: slotKey,
        scheduleId: sched.id,
      });

      const storeAfter = readAdvancedStore();
      const sIdx = storeAfter.schedules.findIndex((s) => s.id === sched.id);
      if (sIdx >= 0) {
        storeAfter.schedules[sIdx].lastJobId = job.id;
        storeAfter.schedules[sIdx].lastJobStatus = job.status;
        appendAuditEvent(
          storeAfter,
          sched.farmId,
          'SCHEDULED_RUN_TRIGGERED',
          `Schedule "${sched.name}" triggered job ${job.id}`,
          'Automation Scheduler'
        );
        writeAdvancedStore(storeAfter);
      }
      triggeredJobIds.push(job.id);
    }

    if (mutated && triggeredJobIds.length === 0) {
      writeAdvancedStore(store);
    }

    return { checked: schedules.length, triggeredJobIds };
  } finally {
    tickInProgress = false;
  }
}

export function startAutomationScheduler(intervalMs = 30000): void {
  if (schedulerHandle) return;
  schedulerHandle = setInterval(() => {
    void runSchedulerTick();
  }, intervalMs);
  // Prevent blocking test/process shutdown cleanly
  if (typeof schedulerHandle.unref === 'function') {
    schedulerHandle.unref();
  }
}

export function stopAutomationScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}
