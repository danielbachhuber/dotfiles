/**
 * Type-only in every consumer, so the stand-in only has to name the shape the
 * panels adapt their RPC proxies onto.
 */
/** The reference a timer is filed under, as the plugins' RPC contracts declare it. */
export interface HarvestExternalReference {
  id: string;
  groupId: string | null;
  accountId: string | null;
  permalink: string | null;
}

export interface HarvestTimerClient {
  assignments(): Promise<{
    projects: Array<{
      id: number;
      name: string;
      code: string | null;
      clientName: string | null;
      tasks: Array<{ id: number; name: string }>;
    }>;
  }>;
  trackedHours(input: { externalId: string; groupId?: string | null }): Promise<{ hours: number }>;
  lastSelection(input: {
    scope: string | null;
  }): Promise<{ projectId: number; taskId: number; exact: boolean } | null>;
  // Typed rather than `unknown`: the panels pass this straight through to a
  // typed rpc.call, and an `unknown` parameter here makes that call unassignable.
  startTimer(input: {
    projectId: number;
    taskId: number;
    notes: string;
    externalReference?: HarvestExternalReference;
  }): Promise<{ entry: unknown }>;
  stopTimer(input: { entryId: number }): Promise<void>;
}
