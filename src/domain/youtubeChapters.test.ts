import { describe, expect, it } from "vitest";
import type { SetSnapshot } from "./bracketProgression";
import type { TournamentWorkspace } from "./tournamentWorkspaceRepository";
import { collectStreamChapterSets, generateYoutubeChapters, parseChapterVideoTime } from "./youtubeChapters";

function makeSet(setId: string): SetSnapshot {
  return {
    setId,
    identifier: setId,
    fullRoundText: "Winners Round 1",
    phaseName: "Main",
    phaseGroupName: "A",
    phaseGroupDisplayIdentifier: "A",
    phaseOrder: 1,
    round: 1,
    state: 3,
    winnerId: "a",
    entrant1Source: null,
    entrant2Source: null,
    slots: [
      { entrantId: "a", entrantName: "Alice", seedId: null, seedNum: null, score: 2 },
      { entrantId: "b", entrantName: "Bob", seedId: null, seedNum: null, score: 0 },
    ],
  };
}

function makeWorkspace(): TournamentWorkspace {
  return {
    snapshot: {
      tournamentId: "tournament",
      slug: "tournament/test",
      name: "Test",
      updatedAt: "2026-10-18T12:00:00Z",
      events: [{ eventId: "event", name: "Event", sets: [makeSet("later"), makeSet("first"), makeSet("unstreamed")] }],
    },
    localMeta: {
      tournamentId: "tournament",
      slug: "tournament/test",
      updatedAt: "2026-10-18T12:00:00Z",
      pendingSetResults: [],
      events: [{
        eventId: "event",
        eventName: "Event",
        eventAlias: null,
        entrants: [
          { entrantId: "a", entrantName: "Alice", aliasName: "アリス", playSide: null, characterNames: [], authCode: "", notes: null },
          { entrantId: "b", entrantName: "Bob", aliasName: "", playSide: null, characterNames: [], authCode: "", notes: null },
        ],
      }],
      setPlaySides: [
        { setId: "first", entrantId: "a", playSide: "2P" },
        { setId: "first", entrantId: "b", playSide: "1P" },
      ],
      setStreamStarts: [
        { eventId: "event", setId: "later", lastStartedAt: "2026-10-18T12:07:45Z" },
        { eventId: "other", setId: "missing", lastStartedAt: "2026-10-18T00:00:00Z" },
        { eventId: "event", setId: "first", lastStartedAt: "2026-10-18T21:00:00+09:00" },
      ],
    },
  };
}

describe("stream chapter sets", () => {
  it("appends only selected categories in slot order with aliases and saved sides", () => {
    const workspace = makeWorkspace();
    const meta = workspace.localMeta.events[0];
    meta.eventManagement = {
      sideDecisionMethod: "upper_1p",
      itemListSnapshots: [
        { id: "characters", name: "Characters", categoryName: "Character", items: ["Ryu", "Ken"] },
        { id: "styles", name: "Styles", categoryName: "Style", items: ["Classic"] },
        { id: "teams", name: "Teams", categoryName: "Team", items: ["Red", "Blue"] },
      ],
    };
    meta.entrants[0].characterNames = ["Red", "Classic", "Ryu", "Ken", "Unknown"];
    meta.entrants[1].characterNames = ["Blue", "Ken"];
    expect(collectStreamChapterSets(workspace, "event", true, [2, 0])[0].matchup)
      .toBe("Bob(Ken/Blue) vs アリス(Ryu,Ken/Red)");
    expect(collectStreamChapterSets(workspace, "event", false, [1])[0].matchup)
      .toBe("Bob vs Alice(Classic)");
    expect(collectStreamChapterSets(workspace, "event", true, [])[0].matchup)
      .toBe("Bob vs アリス");
    const sets = collectStreamChapterSets(workspace, "event", true, [0, 1, 2]);
    expect(generateYoutubeChapters(sets, "Opening", "0:1:0")).toContain(
      "00:01:00 Bob(Ken/Blue) vs アリス(Ryu,Ken/Classic/Red)",
    );
  });

  it("handles missing category settings and items without adding empty parentheses", () => {
    const workspace = makeWorkspace();
    expect(collectStreamChapterSets(workspace, "event", true, [0, 1, 2])[0].matchup)
      .toBe("Bob vs アリス");
  });

  it("matches the player editor's first-category ownership and duplicate policy", () => {
    const workspace = makeWorkspace();
    const meta = workspace.localMeta.events[0];
    meta.eventManagement = {
      sideDecisionMethod: "upper_1p",
      categoryAllowDuplicates: [true, false],
      itemListSnapshots: [
        { id: "first", name: "First", categoryName: "First", items: ["Shared"] },
        { id: "second", name: "Second", categoryName: "Second", items: ["Shared", "Other"] },
      ],
    };
    meta.entrants[0].characterNames = ["Shared", "Shared", "Other", "Other"];
    expect(collectStreamChapterSets(workspace, "event", true, [0, 1])[0].matchup)
      .toBe("Bob vs アリス(Shared,Shared/Other)");
    expect(collectStreamChapterSets(workspace, "event", true, [1])[0].matchup)
      .toBe("Bob vs アリス(Other)");
  });

  it("selects the event's streamed sets chronologically and uses saved 1P/2P and alias settings", () => {
    const workspace = makeWorkspace();
    const sets = collectStreamChapterSets(workspace, "event", true);
    expect(sets.map((set) => set.setId)).toEqual(["first", "later"]);
    expect(sets[0]).toEqual({
      setId: "first",
      setLabel: "Main / Pool A / Set first / Winners Round 1",
      startedAt: Date.parse("2026-10-18T12:00:00Z"),
      matchup: "Bob vs アリス",
    });
    expect(sets[1].matchup).toBe("アリス vs Bob");
    expect(collectStreamChapterSets(workspace, "event", false)[0].matchup).toBe("Bob vs Alice");
    expect(workspace.localMeta.setStreamStarts?.[0].setId).toBe("later");
  });

  it("honors a side assignment when only one player's side was saved", () => {
    const workspace = makeWorkspace();
    workspace.localMeta.setPlaySides = [{ setId: "first", entrantId: "b", playSide: "1P" }];
    expect(collectStreamChapterSets(workspace, "event", false)[0].matchup).toBe("Bob vs Alice");
    workspace.localMeta.setPlaySides = [{ setId: "first", entrantId: "a", playSide: "2P" }];
    expect(collectStreamChapterSets(workspace, "event", false)[0].matchup).toBe("Bob vs Alice");
  });

  it("supports older metadata without stream records", () => {
    const workspace = makeWorkspace();
    delete workspace.localMeta.setStreamStarts;
    expect(collectStreamChapterSets(workspace, "event", true)).toEqual([]);
  });

  it("reports missing sets and invalid timestamps rather than silently omitting chapters", () => {
    const workspace = makeWorkspace();
    workspace.snapshot.events[0].sets = [makeSet("first")];
    expect(() => collectStreamChapterSets(workspace, "event", false)).toThrow("Set later が見つかりません");
    workspace.snapshot.events[0].sets.push(makeSet("later"));
    workspace.localMeta.setStreamStarts![0].lastStartedAt = "invalid";
    expect(() => collectStreamChapterSets(workspace, "event", false)).toThrow("配信開始時刻が不正");
    expect(() => collectStreamChapterSets(workspace, "missing-event", false)).toThrow("イベントが見つかりません");
  });

  it("reports unresolved players and keeps names on a single line", () => {
    const workspace = makeWorkspace();
    workspace.snapshot.events[0].sets[0].slots[0].entrantId = null;
    workspace.snapshot.events[0].sets[0].slots[0].entrantName = "TBD";
    expect(() => collectStreamChapterSets(workspace, "event", true)).toThrow("対戦プレイヤーを特定できません");
    workspace.snapshot.events[0].sets[0] = makeSet("later");
    workspace.localMeta.events[0].entrants[0].aliasName = "アリス\n選手";
    expect(collectStreamChapterSets(workspace, "event", true)[0].matchup).toBe("Bob vs アリス 選手");
  });
});

describe("chapter video time", () => {
  it.each([
    ["00:00", 0],
    ["05:30", 330],
    ["1:02:03", 3723],
    ["1:2:3", 3723],
    ["0:0:0", 0],
    ["2:3", 123],
    ["01:2:03", 3723],
    ["1:02:3", 3723],
    [" 27:00:01 ", 97201],
  ])("parses %s as %i seconds", (input, seconds) => {
    expect(parseChapterVideoTime(input)).toBe(seconds);
  });

  it.each(["", "-01:00", "1", "00:60", "01:60:00", "1:2:60", "1:2:003", "1.5:00", "Infinity:00:00", "99999999999999999:00:00"])(
    "rejects invalid time %s", (input) => {
      expect(() => parseChapterVideoTime(input)).toThrow();
    },
  );
});

describe("YouTube chapter generation", () => {
  it("generates the exact format with the first match's video offset and a custom opening", () => {
    const sets = collectStreamChapterSets(makeWorkspace(), "event", true);
    expect(generateYoutubeChapters(sets, "オープニング", "05:30")).toBe(
      "00:00 オープニング\n00:05:30 Bob vs アリス\n00:13:15 アリス vs Bob",
    );
    expect(generateYoutubeChapters([...sets].reverse(), "大会開始", "01:59:59")).toBe(
      "00:00 大会開始\n01:59:59 Bob vs アリス\n02:07:44 アリス vs Bob",
    );
  });

  it("supports long videos without wrapping hours and truncates subsecond elapsed time", () => {
    const sets = collectStreamChapterSets(makeWorkspace(), "event", false);
    sets[1].startedAt = sets[0].startedAt + 25 * 3600 * 1000 + 1999;
    expect(generateYoutubeChapters(sets, "Opening", "00:00")).toBe(
      "00:00 Opening\n(未記録) Bob vs Alice\n25:00:01 Alice vs Bob",
    );
  });

  it("normalizes single-digit video time components to hh:mm:ss output", () => {
    const sets = collectStreamChapterSets(makeWorkspace(), "event", false);
    expect(generateYoutubeChapters(sets, "Opening", "1:2:3")).toBe(
      "00:00 Opening\n01:02:03 Bob vs Alice\n01:09:48 Alice vs Bob",
    );
  });

  it("aligns to a later selected set and marks negative playback times as unrecorded", () => {
    const sets = collectStreamChapterSets(makeWorkspace(), "event", false);
    expect(generateYoutubeChapters([...sets].reverse(), "Opening", "0:30", "later")).toBe(
      "00:00 Opening\n(未記録) Bob vs Alice\n00:00:30 Alice vs Bob",
    );
    expect(generateYoutubeChapters(sets, "Opening", "10:0", "later")).toBe(
      "00:00 Opening\n00:02:15 Bob vs Alice\n00:10:00 Alice vs Bob",
    );
  });

  it.each([
    ["0:0", "(未記録)"],
    ["0:9", "(未記録)"],
    ["0:10", "00:00:10"],
    ["0:11", "00:00:11"],
  ])("uses the exact ten-second threshold for %s", (time, prefix) => {
    const sets = collectStreamChapterSets(makeWorkspace(), "event", false);
    expect(generateYoutubeChapters(sets, "Opening", time, "first").split("\n")[1])
      .toBe(`${prefix} Bob vs Alice`);
  });

  it("rejects a missing reference set rather than silently choosing another", () => {
    const sets = collectStreamChapterSets(makeWorkspace(), "event", false);
    expect(() => generateYoutubeChapters(sets, "Opening", "0:30", "missing"))
      .toThrow("基準の試合を選び直してください");
  });

  it("rejects empty input and stream history", () => {
    const sets = collectStreamChapterSets(makeWorkspace(), "event", false);
    expect(() => generateYoutubeChapters([], "Opening", "00:00")).toThrow("記録された Set がありません");
    expect(() => generateYoutubeChapters(sets, "  ", "00:00")).toThrow("テキストを入力");
    expect(() => generateYoutubeChapters(sets, "Opening", "")).toThrow("形式で入力");
  });
});
