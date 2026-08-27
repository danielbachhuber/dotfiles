import { describe, expect, it } from "vitest";
import {
  BoardUnavailableError,
  fetchBoardProject,
  ownerOf,
  parseAddedItemId,
  parseIssueItemId,
  parseProjectList,
  parseStatusField,
  setBoardStatus,
  type BoardProject,
} from "./project.js";
import type { GhRunner } from "./gh.js";

const PROJECTS = JSON.stringify({
  projects: [
    {
      id: "PVT_other",
      number: 3,
      title: "Discovery",
      owner: { login: "acme" },
    },
    {
      id: "PVT_board",
      number: 7,
      title: "Acme Board",
      owner: { login: "acme" },
    },
  ],
});

const FIELDS = JSON.stringify({
  fields: [
    { id: "PVTF_title", name: "Title", type: "ProjectV2Field" },
    {
      id: "PVTSSF_status",
      name: "Status",
      type: "ProjectV2SingleSelectField",
      options: [
        { id: "opt-backlog", name: "Backlog" },
        { id: "opt-ready", name: "Ready" },
        { id: "opt-progress", name: "In Progress" },
      ],
    },
  ],
});

/** Records every argv it is given and replays canned stdout in order. */
function runner(responses: string[]): GhRunner & { calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  return {
    calls,
    async run(args: readonly string[]) {
      calls.push([...args]);
      const response = responses[index++];
      if (response === undefined) throw new Error(`unexpected gh call: ${args.join(" ")}`);
      return response;
    },
  } as GhRunner & { calls: string[][] };
}

const BOARD: BoardProject = {
  id: "PVT_board",
  number: 7,
  owner: "acme",
  title: "Acme Board",
  statusFieldId: "PVTSSF_status",
  statusOptions: [
    { id: "opt-backlog", name: "Backlog" },
    { id: "opt-ready", name: "Ready" },
  ],
};

function itemsPayload(projectIds: string[]): string {
  return JSON.stringify({
    data: {
      repository: {
        issue: {
          projectItems: {
            nodes: projectIds.map((id, index) => ({
              id: `PVTI_${index}`,
              project: { id },
            })),
          },
        },
      },
    },
  });
}

describe("parseProjectList", () => {
  it("finds the board by title, not by position", () => {
    // "Discovery" comes first in the payload; matching on order would take it.
    expect(parseProjectList(PROJECTS, "Acme Board")?.id).toBe("PVT_board");
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    expect(parseProjectList(PROJECTS, "  acme board ")?.number).toBe(7);
  });

  it("returns null for a board the owner does not have", () => {
    expect(parseProjectList(PROJECTS, "Nonexistent")).toBeNull();
  });

  it("returns null rather than guessing when no board is configured", () => {
    // Blank means "no board", not "any board": adding an issue to whichever
    // project happened to be first would be a write to the wrong place.
    expect(parseProjectList(PROJECTS, "")).toBeNull();
    expect(parseProjectList(PROJECTS, "   ")).toBeNull();
  });

  it("survives unparseable output", () => {
    expect(parseProjectList("not json", "Acme Board")).toBeNull();
    expect(parseProjectList("{}", "Acme Board")).toBeNull();
  });

  it("skips an entry missing any of the three ids it needs", () => {
    const partial = JSON.stringify({
      projects: [
        { number: 7, title: "Acme Board", owner: { login: "acme" } },
        { id: "PVT_board", title: "Acme Board", owner: { login: "acme" } },
        { id: "PVT_board", number: 7, title: "Acme Board" },
      ],
    });
    expect(parseProjectList(partial, "Acme Board")).toBeNull();
  });
});

describe("parseStatusField", () => {
  it("takes the Status field and its options in board order", () => {
    const status = parseStatusField(FIELDS);
    expect(status?.id).toBe("PVTSSF_status");
    expect(status?.options.map((option) => option.name)).toEqual([
      "Backlog",
      "Ready",
      "In Progress",
    ]);
  });

  it("returns null on a board with no Status field", () => {
    expect(parseStatusField(JSON.stringify({ fields: [{ id: "a", name: "Title" }] }))).toBeNull();
  });

  it("drops an option missing an id or a name", () => {
    // A nameless option cannot be offered and an id-less one cannot be set.
    const raw = JSON.stringify({
      fields: [
        {
          id: "PVTSSF_status",
          name: "Status",
          options: [{ id: "a" }, { name: "Ready" }, { id: "b", name: "Done" }],
        },
      ],
    });
    expect(parseStatusField(raw)?.options).toEqual([{ id: "b", name: "Done" }]);
  });

  it("survives unparseable output", () => {
    expect(parseStatusField("not json")).toBeNull();
  });
});

describe("parseIssueItemId", () => {
  it("picks the item belonging to this board", () => {
    // An issue commonly sits on a team board and someone's personal one; the
    // wrong item id would edit the wrong board.
    expect(parseIssueItemId(itemsPayload(["PVT_personal", "PVT_board"]), "PVT_board")).toBe(
      "PVTI_1",
    );
  });

  it("returns null when the issue is on no board of ours", () => {
    expect(parseIssueItemId(itemsPayload(["PVT_personal"]), "PVT_board")).toBeNull();
    expect(parseIssueItemId(itemsPayload([]), "PVT_board")).toBeNull();
  });

  it("survives unparseable output", () => {
    expect(parseIssueItemId("not json", "PVT_board")).toBeNull();
  });
});

describe("parseAddedItemId", () => {
  it("reads the id of a freshly added item", () => {
    expect(parseAddedItemId(JSON.stringify({ id: "PVTI_new" }))).toBe("PVTI_new");
  });

  it("returns null when the add reported nothing usable", () => {
    expect(parseAddedItemId("{}")).toBeNull();
    expect(parseAddedItemId("")).toBeNull();
  });
});

describe("ownerOf", () => {
  it("takes the owner half of a slug", () => {
    expect(ownerOf("acme/widgets")).toBe("acme");
  });

  it("is empty rather than wrong for a malformed slug", () => {
    expect(ownerOf("")).toBe("");
  });
});

describe("fetchBoardProject", () => {
  it("resolves the board and its Status field in two calls", async () => {
    const gh = runner([PROJECTS, FIELDS]);
    const project = await fetchBoardProject(gh, "acme", "Acme Board");

    expect(project.id).toBe("PVT_board");
    expect(project.statusFieldId).toBe("PVTSSF_status");
    expect(project.statusOptions).toHaveLength(3);
    expect(gh.calls[0]).toEqual(["project", "list", "--owner", "acme", "--format", "json"]);
    expect(gh.calls[1]).toEqual([
      "project", "field-list", "7", "--owner", "acme", "--format", "json",
    ]);
  });

  it("refuses to guess when no board is configured", async () => {
    const gh = runner([]);
    await expect(fetchBoardProject(gh, "acme", "")).rejects.toBeInstanceOf(BoardUnavailableError);
    // And spends nothing finding that out.
    expect(gh.calls).toHaveLength(0);
  });

  it("names the board it could not find", async () => {
    const gh = runner([PROJECTS]);
    await expect(fetchBoardProject(gh, "acme", "Missing")).rejects.toThrow(/Missing/);
  });

  it("still returns the board when it has no Status field", async () => {
    // The board is real and issues can be added to it; only the picker is lost.
    const gh = runner([PROJECTS, JSON.stringify({ fields: [] })]);
    const project = await fetchBoardProject(gh, "acme", "Acme Board");
    expect(project.id).toBe("PVT_board");
    expect(project.statusFieldId).toBeNull();
  });
});

describe("setBoardStatus", () => {
  const issue = { repo: "acme/widgets", number: 42, url: "https://github.com/acme/widgets/issues/42" };

  it("edits in place when the issue is already on the board", async () => {
    const gh = runner([itemsPayload(["PVT_board"]), ""]);
    const result = await setBoardStatus(gh, {
      project: BOARD,
      ...issue,
      option: { id: "opt-ready", name: "Ready" },
    });

    expect(result.added).toBe(false);
    expect(gh.calls).toHaveLength(2);
    expect(gh.calls[1]).toEqual([
      "project", "item-edit",
      "--id", "PVTI_0",
      "--project-id", "PVT_board",
      "--field-id", "PVTSSF_status",
      "--single-select-option-id", "opt-ready",
    ]);
  });

  it("adds then sets, so a new issue never lands with no status", async () => {
    const gh = runner([itemsPayload([]), JSON.stringify({ id: "PVTI_new" }), ""]);
    const result = await setBoardStatus(gh, {
      project: BOARD,
      ...issue,
      option: { id: "opt-backlog", name: "Backlog" },
    });

    expect(result.added).toBe(true);
    expect(gh.calls[1]).toEqual([
      "project", "item-add", "7", "--owner", "acme", "--url", issue.url, "--format", "json",
    ]);
    expect(gh.calls[2]?.slice(0, 2)).toEqual(["project", "item-edit"]);
    expect(gh.calls[2]).toContain("PVTI_new");
  });

  it("adds without editing when no option was asked for", async () => {
    const gh = runner([itemsPayload([]), JSON.stringify({ id: "PVTI_new" })]);
    await setBoardStatus(gh, { project: BOARD, ...issue, option: null });
    expect(gh.calls).toHaveLength(2);
  });

  it("reports an add that produced no item id", async () => {
    // Editing with an undefined id would be a write against the wrong item.
    const gh = runner([itemsPayload([]), "{}"]);
    await expect(
      setBoardStatus(gh, { project: BOARD, ...issue, option: { id: "opt-ready", name: "Ready" } }),
    ).rejects.toBeInstanceOf(BoardUnavailableError);
  });

  it("refuses to set a status on a board that has no Status field", async () => {
    const gh = runner([itemsPayload(["PVT_board"])]);
    await expect(
      setBoardStatus(gh, {
        project: { ...BOARD, statusFieldId: null },
        ...issue,
        option: { id: "opt-ready", name: "Ready" },
      }),
    ).rejects.toThrow(/no Status field/);
  });

  it("rejects a malformed repository slug before calling anything", async () => {
    const gh = runner([]);
    await expect(
      setBoardStatus(gh, {
        project: BOARD,
        repo: "widgets",
        number: 42,
        url: issue.url,
        option: null,
      }),
    ).rejects.toBeInstanceOf(BoardUnavailableError);
    expect(gh.calls).toHaveLength(0);
  });
});
