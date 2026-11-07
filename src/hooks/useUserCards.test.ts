import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserCardPlayer } from "./userCardCanvas";
import { useUserCards } from "./useUserCards";
import type { PlayerListCsvCategory } from "../domain/playerListCsv";

const { states, renderCard, download } = vi.hoisted(() => ({
  states: [] as unknown[],
  renderCard: vi.fn(),
  download: vi.fn(),
}));

vi.mock("react", () => ({
  useState: () => [states.shift(), vi.fn()],
  useMemo: (factory: () => unknown) => factory(),
  useEffect: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./userCardCanvas", async (importOriginal) => ({
  ...await importOriginal<typeof import("./userCardCanvas")>(),
  renderPlayerCardCanvas: renderCard,
  canvasToBlob: vi.fn(async () => new Blob()),
  triggerBlobDownload: download,
}));

const player: UserCardPlayer = {
  tournamentId: "tournament",
  tournamentName: "Tournament",
  eventId: "event",
  eventName: "Event",
  eventAlias: "Event Alias",
  entrantId: "entrant",
  entrantName: "Original Player",
  playerName: "Original Player",
  aliasName: "Registered Alias",
  skill: 5,
  playerId: "PG-PLAYER",
  categorySelections: [["A", "B"], ["Stage"], []],
};
const missingAliasCases: Record<string, string>[] = [
  {},
  { entrant: "" },
  { entrant: "  " },
  { other: "Other Alias" },
];

function setup(useAliasName: boolean, aliases: Record<string, string> = { entrant: " Alias " }, categoryLists: PlayerListCsvCategory[] = []) {
  states.push([player], [player.playerId], player.playerId, "preview-url", false);
  return useUserCards({
    tournamentId: player.tournamentId,
    tournamentName: player.tournamentName,
    eventId: player.eventId,
    eventName: player.eventName,
    eventAlias: player.eventAlias,
    entrants: [{
      entrantId: player.entrantId,
      entrantName: player.entrantName,
      aliasName: player.aliasName,
      skill: player.skill,
      categorySelections: player.categorySelections,
    }],
    categoryLists,
    aliasNamesByEntrantId: aliases,
    useAliasName,
    disableLocalCommunication: false,
    onError: vi.fn(),
    onMessage: vi.fn(),
  });
}

beforeEach(() => {
  states.length = 0;
  vi.clearAllMocks();
  renderCard.mockResolvedValue({});
});

describe("player card alias display", () => {
  it("applies the trimmed alias to both list and selected player without changing identity", () => {
    const result = setup(true);
    expect(result.players).toEqual([{ ...player, entrantName: "Alias" }]);
    expect(result.selectedPlayer).toEqual(result.players[0]);
    expect(result.selectedPlayerIds).toEqual([player.playerId]);
    expect(player.entrantName).toBe("Original Player");
  });

  it("restores the original name when alias display is disabled", () => {
    expect(setup(true).selectedPlayer?.entrantName).toBe("Alias");
    expect(setup(false).players).toEqual([player]);
  });

  it.each(missingAliasCases)(
    "keeps the original name when this entrant has no alias: %j",
    (aliases) => {
      expect(setup(true, aliases).players).toEqual([player]);
    },
  );

  it("uses the same alias for saved cards and their filenames", async () => {
    await setup(true).saveSelectedCards();
    expect(renderCard).toHaveBeenCalledWith({ ...player, entrantName: "Alias" });
    expect(download).toHaveBeenCalledWith(expect.any(Blob), "Event-Alias_Alias.png");
  });

  it("exports the complete player metadata to a CSV file", async () => {
    const result = setup(false);
    result.exportPlayersAsCsv();

    expect(download).toHaveBeenCalledWith(expect.any(Blob), "Event-Alias_players.csv");
    const csvBlob = vi.mocked(download).mock.calls[0][0] as Blob;
    await expect(csvBlob.text()).resolves.toContain(
      "プレイヤー名,エイリアスプレイヤー名,Skill Tier,Player ID\r\n"
      + "Original Player,Registered Alias,5,PG-PLAYER",
    );
  });

  it("exports category selections using configured category names", async () => {
    const result = setup(false, { entrant: "Alias" }, [
      { id: "character-list", name: "Characters", categoryName: "Fighter", slotIndex: 0 },
      { id: "stage-list", name: "Stages", categoryName: "Arena", slotIndex: 1 },
      { id: "item-list", name: "Items", categoryName: "Consumable", slotIndex: 2 },
    ]);
    result.exportPlayersAsCsv();

    const csvBlob = vi.mocked(download).mock.calls[0][0] as Blob;
    await expect(csvBlob.text()).resolves.toContain(
      "プレイヤー名,エイリアスプレイヤー名,Skill Tier,Player ID,Characters/Fighter,Stages/Arena,Items/Consumable\r\n"
      + 'Original Player,Registered Alias,5,PG-PLAYER,"A,B",Stage,\r\n',
    );
  });
});
