/**
 * The server half of the stand-in: a bridge that is always unavailable.
 *
 * Every method the real bridge exposes is here, returning the emptiest value
 * its plugin's RPC contract accepts. `available()` is false, so the panel never
 * draws a clock and never calls the rest — but a method reached by a stale
 * frontend still answers in the right shape rather than throwing.
 */
interface LoggingApi {
  log: { info(message: string): void };
}

let announced = false;

export function createHarvestBridge(bb: LoggingApi) {
  // Once per load, not per call. A build without the Harvest plugin is a real
  // difference in what the panel can do, and the alternative — a clock that is
  // simply never there — looks identical to Harvest not running.
  if (!announced) {
    announced = true;
    bb.log.info(
      "Harvest integration is not compiled into this build " +
        "(bb-plugin-harvest was not installed when it was built). " +
        "Timers are unavailable; rebuild where the Harvest plugin is checked out to restore them.",
    );
  }

  return {
    available: async () => false,
    runningReference: async () => null,
    assignments: async () => ({ projects: [] }),
    trackedHours: async (_input: { externalId: string; groupId?: string | null }) => ({ hours: 0 }),
    lastSelection: async (_input: { scope: string | null }) => null,
    startTimer: async (_input: {
      projectId: number;
      taskId: number;
      notes: string;
      externalReference?: {
        id: string;
        groupId: string | null;
        accountId: string | null;
        permalink: string | null;
      };
    }) => ({ entry: null }),
    stopTimer: async (_input: { entryId: number }) => undefined,
  };
}
