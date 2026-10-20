import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaySide } from "./useTournamentWorkspace";
import { usePlayerMetaDrafts } from "./usePlayerMetaDrafts";

type Draft = { aliasName: string; playSide: PlaySide | ""; categorySelections: string[][] };
type Drafts = Record<string, Draft>;
const state = vi.hoisted(() => ({
  drafts: {} as Drafts,
  dirty: { current: new Map<string, Set<keyof Draft>>() },
  hydrate: () => {},
}));

vi.mock("react", () => ({
  useState: () => [
    state.drafts,
    (next: Drafts | ((current: Drafts) => Drafts)) => {
      state.drafts = typeof next === "function" ? next(state.drafts) : next;
    },
  ],
  useRef: () => state.dirty,
  useEffect: (effect: () => void) => { state.hydrate = effect; },
}));

type Options = Parameters<typeof usePlayerMetaDrafts>[0];

function setup(hasSavedMeta = true) {
  const list = { id: "list", name: "List", categoryName: "Characters", items: ["A", "B", "C"] };
  const event = { eventId: "event", name: "Event", sets: [] };
  const entrant = { entrantId: "player", entrantName: "Player" };
  const save = vi.fn().mockResolvedValue(undefined);
  const options: Options = {
    selectedEvent: event,
    selectedEventMeta: {
      eventId: event.eventId,
      eventName: event.name,
      eventAlias: null,
      entrants: hasSavedMeta ? [{
        ...entrant, aliasName: "Saved alias", playSide: "2P",
        characterNames: ["A", "B", "Legacy item"], notes: "Keep notes", authCode: "auth",
      }] : [],
    },
    selectedEventEntrants: [entrant],
    selectedEntrant: entrant,
    categorySlotListIds: [list.id, "", ""],
    categorySlotAllowDuplicates: [false, false, false],
    totalItemMinCount: 2,
    totalItemMaxCount: 3,
    itemLists: [list],
    selectedEventItemListSnapshots: [],
    slug: "tournament/example",
    configuredCategorySlots: [{ slotIndex: 0, list, minCount: 2, maxCount: 3, allowDuplicates: false }],
    saveLocalPlayerMeta: save,
    setBusy: vi.fn(),
    setError: vi.fn(),
    setMessage: vi.fn(),
  };
  const render = () => usePlayerMetaDrafts(options);
  render();
  state.hydrate();
  return {
    options, save, render, event, entrant,
    hydrateSaved(aliasName: string, characterNames: string[]) {
      const meta = options.selectedEventMeta;
      if (!meta) throw new Error("Test metadata is missing.");
      meta.entrants = [{
        ...entrant, aliasName, characterNames, playSide: "2P", notes: "Keep notes", authCode: "auth",
      }];
      render();
      state.hydrate();
      return render();
    },
  };
}

beforeEach(() => {
  state.drafts = {};
  state.dirty.current.clear();
});

describe("independent player metadata saves", () => {
  it("saves only the alias even when selections are invalid, preserving saved and unsaved selections", async () => {
    const test = setup();
    test.render().setMetaDraft("event", "player", {
      aliasName: "New alias", categorySelections: [[], [], []],
    });
    expect(test.render().selectedEntrantValidationErrors.length).toBeGreaterThan(0);

    await test.render().saveSelectedEntrantAliasName();

    expect(test.save).toHaveBeenCalledWith(expect.objectContaining({
      aliasName: "New alias", characterNames: ["A", "B", "Legacy item"],
      playSide: "2P", notes: "Keep notes",
    }));
    expect(test.options.setMessage).toHaveBeenCalledWith("プレイヤーエイリアス名を保存しました。");
    const result = test.hydrateSaved("New alias", ["A", "B", "Legacy item"]);
    expect(result.selectedEntrantAliasName).toBe("New alias");
    expect(result.selectedEntrantDraftSelectionsBySlot).toEqual([[]]);
  });

  it("saves only selections and retains an unsaved alias through metadata hydration", async () => {
    const test = setup();
    test.render().setMetaDraft("event", "player", {
      aliasName: "Unsaved alias", categorySelections: [["B", "C"], [], []],
    });

    await test.render().saveSelectedEntrantSelections();

    expect(test.save).toHaveBeenCalledWith(expect.objectContaining({
      aliasName: "Saved alias", characterNames: ["B", "C"], playSide: "2P", notes: "Keep notes",
    }));
    expect(test.options.setMessage).toHaveBeenCalledWith("アイテムの選択状態を保存しました。");
    const result = test.hydrateSaved("Saved alias", ["B", "C"]);
    expect(result.selectedEntrantAliasName).toBe("Unsaved alias");
    expect(result.selectedEntrantDraftSelectionsBySlot).toEqual([["B", "C"]]);
  });

  it("still validates category limits when saving selections", async () => {
    const test = setup();
    test.render().setMetaDraft("event", "player", { categorySelections: [["A"], [], []] });
    await test.render().saveSelectedEntrantSelections();
    expect(test.save).not.toHaveBeenCalled();
    expect(test.options.setError).toHaveBeenCalledWith(expect.stringContaining("最低"));
  });

  it.each([true, false])("allows clearing an alias without saving draft selections (saved metadata: %s)", async (hasSavedMeta) => {
    const test = setup(hasSavedMeta);
    test.render().setMetaDraft("event", "player", {
      aliasName: "", categorySelections: [["C"], [], []],
    });
    await test.render().saveSelectedEntrantAliasName();
    expect(test.save).toHaveBeenCalledWith(expect.objectContaining({
      aliasName: "", characterNames: hasSavedMeta ? ["A", "B", "Legacy item"] : [],
      playSide: hasSavedMeta ? "2P" : null, notes: hasSavedMeta ? "Keep notes" : null,
    }));
    expect(test.render().selectedEntrantDraftSelectionsBySlot).toEqual([["C"]]);
  });

  it.each(["alias", "selections"] as const)("can save both fields independently with %s first", async (first) => {
    const test = setup();
    test.render().setMetaDraft("event", "player", {
      aliasName: "New alias", categorySelections: [["B", "C"], [], []],
    });
    if (first === "alias") {
      await test.render().saveSelectedEntrantAliasName();
      test.hydrateSaved("New alias", ["A", "B", "Legacy item"]);
      await test.render().saveSelectedEntrantSelections();
    } else {
      await test.render().saveSelectedEntrantSelections();
      test.hydrateSaved("Saved alias", ["B", "C"]);
      await test.render().saveSelectedEntrantAliasName();
    }
    expect(test.save).toHaveBeenLastCalledWith(expect.objectContaining({
      aliasName: "New alias", characterNames: ["B", "C"],
    }));
    const result = test.hydrateSaved("New alias", ["B", "C"]);
    expect(result.selectedEntrantAliasName).toBe("New alias");
    expect(result.selectedEntrantDraftSelectionsBySlot).toEqual([["B", "C"]]);
  });

  it("hydrates clean fields independently when another field is still dirty", async () => {
    const test = setup();
    test.render().setSelectedEntrantAliasName("Unsaved alias");
    const result = test.hydrateSaved("Changed elsewhere", ["C", "B"]);
    expect(result.selectedEntrantAliasName).toBe("Unsaved alias");
    expect(result.selectedEntrantDraftSelectionsBySlot).toEqual([["C", "B"]]);
  });

  it("preserves alias edits made while an alias save is in progress", async () => {
    const test = setup();
    let finish = () => {};
    test.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    test.render().setSelectedEntrantAliasName("Submitted alias");
    const saving = test.render().saveSelectedEntrantAliasName();
    test.render().setSelectedEntrantAliasName("Edited during save");
    finish();
    await saving;
    const result = test.hydrateSaved("Submitted alias", ["A", "B", "Legacy item"]);
    expect(result.selectedEntrantAliasName).toBe("Edited during save");
  });

  it("reports save failures, retains drafts, and releases the busy state", async () => {
    const test = setup();
    test.save.mockRejectedValueOnce(new Error("Save failed"));
    test.render().setSelectedEntrantAliasName("Retry alias");
    await test.render().saveSelectedEntrantAliasName();
    expect(test.options.setError).toHaveBeenCalledWith("Error: Save failed");
    expect(test.options.setBusy).toHaveBeenLastCalledWith(false);
    expect(test.options.setMessage).not.toHaveBeenCalledWith("プレイヤーエイリアス名を保存しました。");
    const result = test.hydrateSaved("Saved alias", ["A", "B"]);
    expect(result.selectedEntrantAliasName).toBe("Retry alias");
  });
});
