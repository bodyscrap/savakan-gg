import { describe, expect, it } from "vitest";
import { importRegistrationCsv, parseRegistrationCsv } from "./localRegistrationCsv";
import { canRegisterParticipant, defaultLocalEventRegistration } from "./localEventRegistration";

function registration() {
  const result = defaultLocalEventRegistration();
  result.setting.itemListSnapshots = [
    { id: "robots", name: "Robots", categoryName: "Robot", items: ["ジャッカル", "ヴァイス"] },
    { id: "", name: "", categoryName: "", items: [] },
    { id: "colors", name: "Colors", categoryName: "Color", items: ["Red"] },
  ];
  result.setting.categoryMinCounts = [1, 0, 0];
  result.setting.categoryMaxCounts = [2, 0, 1];
  return result;
}

describe("registration CSV", () => {
  it("drops unknown items but retains matching items in a mixed CSV cell", () => {
    const csv = parseRegistrationCsv('name,items\nAlice,"ジャッカル,unknown"\nBob,unknown');
    const players = importRegistrationCsv(csv, { name: 0, categories: [1, null, null] }, registration());
    expect(players[0].categorySelections).toEqual([["ジャッカル"], [], []]);
    expect(players[1].categorySelections).toEqual([[], [], []]);
    expect(players[1].selectionsConfirmed).toBe(false);
  });
  it("reads BOM, Japanese headers, CRLF and preserves row order", () => {
    const csv = parseRegistrationCsv("\uFEFFアカウント名,エントリー名,使用機体\r\nAccount,Alice,ジャッカル\r\nBob,Bob,ヴァイス\r\n");
    expect(csv.headers).toEqual(["アカウント名", "エントリー名", "使用機体"]);
    const players = importRegistrationCsv(csv, { name: 1, categories: [2, null, null] }, registration(), () => "id");
    expect(players.map((player) => player.name)).toEqual(["Alice", "Bob"]);
    expect(players[0].categorySelections).toEqual([["ジャッカル"], [], []]);
    expect(players.every((player) => player.selectionsConfirmed)).toBe(true);
  });

  it("supports quoted commas, newlines and escaped quotes", () => {
    const csv = parseRegistrationCsv('name,items\n"Alice, ""A""","ジャッカル,\nヴァイス"\n');
    expect(csv.rows[0][0]).toBe('Alice, "A"');
    const [player] = importRegistrationCsv(csv, { name: 0, categories: [1, null, null] }, registration());
    expect(player.categorySelections[0]).toEqual(["ジャッカル", "ヴァイス"]);
  });

  it("only matches items in their assigned enabled category and leaves missing items unset", () => {
    const csv = parseRegistrationCsv("name,robot,color\nAlice,Red,ジャッカル\nBob,ジャッカル,Red");
    const players = importRegistrationCsv(csv, { name: 0, categories: [1, 1, 2] }, registration());
    expect(players[0].categorySelections).toEqual([[], [], []]);
    expect(players[0].selectionsConfirmed).toBe(false);
    expect(players[1].categorySelections).toEqual([["ジャッカル"], [], ["Red"]]);
    expect(importRegistrationCsv(csv, { name: 0, categories: [null, null, null] }, registration())[0].categorySelections)
      .toEqual([[], [], []]);
  });

  it("keeps incomplete imports editable and respects optional registration", () => {
    const current = registration();
    const csv = parseRegistrationCsv("name,items\nAlice,unknown");
    const [player] = importRegistrationCsv(csv, { name: 0, categories: [1, null, null] }, current);
    expect(canRegisterParticipant(player, current)).toBe(false);
    expect(canRegisterParticipant(player, { ...current, requireItemSelections: false })).toBe(true);
  });

  it("deduplicates only when duplicates are not allowed and preserves upper-limit errors", () => {
    const current = registration();
    const csv = parseRegistrationCsv('name,items\nAlice,"ジャッカル,ジャッカル,ヴァイス"');
    const mapping = { name: 0, categories: [1, null, null] };
    expect(importRegistrationCsv(csv, mapping, current)[0].categorySelections[0]).toHaveLength(2);
    current.setting.categoryAllowDuplicates = [true, false, false];
    const [player] = importRegistrationCsv(csv, mapping, current);
    expect(player.categorySelections[0]).toHaveLength(3);
    expect(player.selectionsConfirmed).toBe(false);
  });

  it.each([
    "", "name,items\n", "name,\nAlice,A", 'name\n"Alice', 'name\nA"lice',
    'name\n"Alice"oops', "name,items\nAlice", "name\n" + "Alice\n".repeat(513),
  ])("rejects malformed or out-of-range CSV", (source) => {
    expect(() => parseRegistrationCsv(source)).toThrow();
  });

  it("validates column mapping and empty names before returning replacements", () => {
    const csv = parseRegistrationCsv("name,items\nAlice,ジャッカル\n ,ヴァイス");
    expect(() => importRegistrationCsv(csv, { name: -1, categories: [] }, registration())).toThrow();
    expect(() => importRegistrationCsv(csv, { name: 0, categories: [99] }, registration())).toThrow();
    expect(() => importRegistrationCsv(csv, { name: 0, categories: [1] }, registration())).toThrow("3行目");
  });
});
