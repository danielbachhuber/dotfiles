// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { HarvestTimerPicker, type HarvestTimerClient } from "./timer-picker.js";

afterEach(cleanup);

const PROJECTS = [
  {
    id: 11,
    name: "Internal",
    code: "INT",
    clientName: "New_ Public",
    tasks: [
      { id: 22, name: "Development" },
      { id: 23, name: "Review" },
    ],
  },
  {
    id: 12,
    name: "Website",
    code: null,
    clientName: "New_ Public",
    tasks: [{ id: 24, name: "Design" }],
  },
];

const REFERENCE = {
  id: "5515",
  groupId: "psi-product",
  accountId: "danielbachhuber",
  permalink: "https://github.com/danielbachhuber/psi-product/issues/5515",
};

function fakeClient(overrides: Partial<HarvestTimerClient> = {}): HarvestTimerClient {
  return {
    assignments: vi.fn(async () => ({ projects: PROJECTS })),
    trackedHours: vi.fn(async () => ({ hours: 0 })),
    startTimer: vi.fn(async () => ({ entry: null })),
    lastSelection: vi.fn(async () => null),
    ...overrides,
  };
}

function renderPicker(
  client: HarvestTimerClient,
  props: Partial<React.ComponentProps<typeof HarvestTimerPicker>> = {},
) {
  return render(
    <HarvestTimerPicker
      client={client}
      defaults={{ notes: "#5515: Audit areas", externalReference: REFERENCE }}
      onStarted={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  );
}

describe("loading", () => {
  test("prefills the note it was given", async () => {
    renderPicker(fakeClient());

    const notes = await screen.findByLabelText("Notes");
    expect((notes as HTMLTextAreaElement).value).toBe("#5515: Audit areas");
  });

  test("asks for the selection remembered against the reference's group", async () => {
    const lastSelection = vi.fn(async () => null);
    renderPicker(fakeClient({ lastSelection }));

    await waitFor(() => expect(lastSelection).toHaveBeenCalledWith({ scope: "psi-product" }));
  });

  test("asks for the most recent selection when there is nothing to scope to", async () => {
    const lastSelection = vi.fn(async () => null);
    renderPicker(fakeClient({ lastSelection }), {
      defaults: { notes: "", externalReference: undefined },
    });

    await waitFor(() => expect(lastSelection).toHaveBeenCalledWith({ scope: null }));
  });

  test("shows an empty state when the account has no assignable projects", async () => {
    const client = fakeClient({ assignments: vi.fn(async () => ({ projects: [] })) });
    renderPicker(client);

    expect(await screen.findByText(/no projects/i)).toBeTruthy();
  });

  test("shows a resting timer of zero before anything starts", async () => {
    renderPicker(fakeClient());

    expect(await screen.findByText("0:00")).toBeTruthy();
  });
});

describe("tracked hours", () => {
  test("reports the hours already tracked against the reference", async () => {
    const client = fakeClient({ trackedHours: vi.fn(async () => ({ hours: 0.4166666667 })) });
    const { container } = renderPicker(client);

    // The sentence is bold-split across spans, so it is asserted against the
    // rendered text rather than a single element.
    await waitFor(() =>
      expect(container.textContent).toContain("has 0:25 tracked to it"),
    );
  });

  test("scopes the total to the reference's group", async () => {
    const trackedHours = vi.fn(async () => ({ hours: 0 }));
    renderPicker(fakeClient({ trackedHours }));

    await waitFor(() =>
      expect(trackedHours).toHaveBeenCalledWith({ externalId: "5515", groupId: "psi-product" }),
    );
  });

  test("says nothing when no time has been tracked yet", async () => {
    const { container } = renderPicker(fakeClient());

    await screen.findByLabelText("Notes");
    expect(container.textContent).not.toContain("tracked to it");
  });

  test("does not ask about hours when there is nothing to link to", async () => {
    const trackedHours = vi.fn(async () => ({ hours: 0 }));
    renderPicker(fakeClient({ trackedHours }), {
      defaults: { notes: "", externalReference: undefined },
    });

    await screen.findByLabelText("Notes");
    expect(trackedHours).not.toHaveBeenCalled();
  });
});

describe("starting", () => {
  test("starts against the resolved project and task", async () => {
    const startTimer = vi.fn(async () => ({ entry: null }));
    renderPicker(fakeClient({ startTimer }));

    fireEvent.click(await screen.findByRole("button", { name: "Start timer" }));

    await waitFor(() =>
      expect(startTimer).toHaveBeenCalledWith({
        projectId: 11,
        taskId: 22,
        notes: "#5515: Audit areas",
        externalReference: REFERENCE,
      }),
    );
  });

  test("starts against the remembered selection rather than the first project", async () => {
    const startTimer = vi.fn(async () => ({ entry: null }));
    const client = fakeClient({
      startTimer,
      lastSelection: vi.fn(async () => ({ projectId: 12, taskId: 24 })),
    });
    renderPicker(client);

    fireEvent.click(await screen.findByRole("button", { name: "Start timer" }));

    await waitFor(() =>
      expect(startTimer).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 12, taskId: 24 }),
      ),
    );
  });

  test("sends the edited note", async () => {
    const startTimer = vi.fn(async () => ({ entry: null }));
    renderPicker(fakeClient({ startTimer }));

    const notes = await screen.findByLabelText("Notes");
    fireEvent.change(notes, { target: { value: "Pairing on the audit" } });
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));

    await waitFor(() =>
      expect(startTimer).toHaveBeenCalledWith(
        expect.objectContaining({ notes: "Pairing on the audit" }),
      ),
    );
  });

  test("omits the reference when there is nothing to link to", async () => {
    const startTimer = vi.fn(async () => ({ entry: null }));
    renderPicker(fakeClient({ startTimer }), {
      defaults: { notes: "Reading", externalReference: undefined },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Start timer" }));

    await waitFor(() =>
      expect(startTimer).toHaveBeenCalledWith({
        projectId: 11,
        taskId: 22,
        notes: "Reading",
      }),
    );
  });

  test("hands the started entry back to the caller", async () => {
    const entry = {
      id: 900,
      projectName: "Internal",
      taskName: "Development",
      notes: "note",
      hours: 0,
      timerStartedAt: "2026-09-02T10:00:00Z",
      externalReference: REFERENCE,
    };
    const onStarted = vi.fn();
    renderPicker(fakeClient({ startTimer: vi.fn(async () => ({ entry })) }), { onStarted });

    fireEvent.click(await screen.findByRole("button", { name: "Start timer" }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(entry));
  });

  test("cannot be started when the account has no assignable projects", async () => {
    const client = fakeClient({ assignments: vi.fn(async () => ({ projects: [] })) });
    renderPicker(client);

    await screen.findByText(/no projects/i);
    expect(screen.queryByRole("button", { name: "Start timer" })).toBeNull();
  });

  test("keeps the draft and reports the failure when Harvest refuses", async () => {
    const startTimer = vi.fn(async () => {
      throw new Error("Harvest said no");
    });
    const onStarted = vi.fn();
    renderPicker(fakeClient({ startTimer }), { onStarted });

    fireEvent.change(await screen.findByLabelText("Notes"), {
      target: { value: "Worth keeping" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    // Losing what the user typed because a request failed is the worst
    // possible response to a failed request.
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Worth keeping");
    expect(onStarted).not.toHaveBeenCalled();
  });

  test("does not start twice when the button is clicked twice", async () => {
    let release = () => {};
    const startTimer = vi.fn(
      () => new Promise<{ entry: null }>((resolve) => (release = () => resolve({ entry: null }))),
    );
    renderPicker(fakeClient({ startTimer }));

    const button = await screen.findByRole("button", { name: "Start timer" });
    fireEvent.click(button);
    fireEvent.click(button);
    release();

    await waitFor(() => expect(startTimer).toHaveBeenCalledTimes(1));
  });
});

describe("cancelling", () => {
  test("tells the caller to close", async () => {
    const onCancel = vi.fn();
    renderPicker(fakeClient(), { onCancel });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
  });
});
