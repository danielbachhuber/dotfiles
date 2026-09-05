/**
 * Type-only in every consumer, so the stand-in only has to name the shape the
 * panels adapt their RPC proxies onto.
 */
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
  startTimer(input: unknown): Promise<{ entry: unknown }>;
  stopTimer(input: { entryId: number }): Promise<void>;
}
