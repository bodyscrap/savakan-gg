import { describe, expect, it } from "vitest";
import { FREE_TEXT_LIST_ID } from "./itemList";
import { buildPlayerListCsv, buildPlayerListCsvFileName } from "./playerListCsv";

describe("buildPlayerListCsv", () => {
  it("writes the requested columns and preserves Japanese text and skill tier zero", () => {
    const csv = buildPlayerListCsv([{
      playerName: "選手, 一郎",
      aliasName: "別名",
      skill: 0,
      playerId: "PG-123",
    }]);

    expect(csv).toBe(
      "\uFEFFプレイヤー名,エイリアスプレイヤー名,Skill Tier,Player ID\r\n"
      + '"選手, 一郎",別名,0,PG-123\r\n',
    );
  });

  it("escapes quotes and newlines and leaves an unset skill tier blank", () => {
    const csv = buildPlayerListCsv([{
      playerName: 'Player "One"',
      aliasName: "Alias\nName",
      skill: null,
      playerId: "PG-456",
    }]);

    expect(csv).toContain('"Player ""One""","Alias\nName",,PG-456');
  });

  it("exports each category and quotes comma-separated multi-selections", () => {
    const csv = buildPlayerListCsv([{
      playerName: "Player",
      aliasName: "",
      skill: null,
      playerId: "PG-789",
      categorySelections: [["A", "B"], ["Single", "Other"], []],
    }], [
      { id: "character-list", name: "Characters", categoryName: "Fighter", slotIndex: 0 },
      { id: FREE_TEXT_LIST_ID, name: "自由記入", categoryName: "その他", slotIndex: 1 },
      { id: "item-list", name: "Items", categoryName: "Consumable", slotIndex: 2 },
    ]);

    expect(csv).toContain("プレイヤー名,エイリアスプレイヤー名,Skill Tier,Player ID,Characters/Fighter,その他,Items/Consumable\r\n");
    expect(csv).toContain('Player,,,PG-789,"A,B","Single,Other",\r\n');
  });
});

it("creates a filesystem-safe event CSV filename", () => {
  expect(buildPlayerListCsvFileName("Cup/Final", "Event")).toBe("Cup-Final_players.csv");
  expect(buildPlayerListCsvFileName(null, "Event")).toBe("Event_players.csv");
});
