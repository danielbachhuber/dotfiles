/**
 * Selection rules for the timer picker.
 *
 * Kept separate from the component so the behavior that matters is testable
 * without driving a Radix popover in jsdom, and so the component stays a thin
 * rendering layer over decisions made here.
 */

export interface PickerTask {
  id: number;
  name: string;
}

export interface PickerProject {
  id: number;
  name: string;
  code: string | null;
  clientName: string | null;
  tasks: PickerTask[];
}

export interface PickerSelection {
  projectId: number;
  taskId: number;
}

/** The tasks available under one project. */
export function tasksFor(projects: PickerProject[], projectId: number | null): PickerTask[] {
  if (projectId === null) return [];
  return projects.find((project) => project.id === projectId)?.tasks ?? [];
}

/**
 * What the picker should open with.
 *
 * A remembered selection is honored only as far as it is still valid: a
 * project the user has since been unassigned from, or a task that no longer
 * exists on it, is repaired rather than offered, because Harvest rejects both
 * with an error that says nothing useful.
 */
export function resolveSelection(
  projects: PickerProject[],
  remembered: PickerSelection | null,
): PickerSelection | null {
  if (projects.length === 0) return null;

  if (remembered !== null) {
    const project = projects.find((candidate) => candidate.id === remembered.projectId);
    if (project !== undefined) {
      const task = project.tasks.find((candidate) => candidate.id === remembered.taskId);
      return { projectId: project.id, taskId: task?.id ?? (project.tasks[0]?.id as number) };
    }
  }

  return firstSelection(projects);
}

/**
 * The selection after choosing a project.
 *
 * The task always moves with it. Carrying the previous task over would post a
 * task that does not belong to the project.
 */
export function withProject(
  projects: PickerProject[],
  projectId: number,
): PickerSelection | null {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) return null;

  const taskId = project.tasks[0]?.id;
  if (taskId === undefined) return null;

  return { projectId: project.id, taskId };
}

function firstSelection(projects: PickerProject[]): PickerSelection | null {
  for (const project of projects) {
    const taskId = project.tasks[0]?.id;
    if (taskId !== undefined) return { projectId: project.id, taskId };
  }

  return null;
}
