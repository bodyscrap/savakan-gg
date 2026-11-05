import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SetSnapshot } from "../domain/bracketProgression";
import { FirstToNWinsBracket } from "./FirstToNWinsBracket";

function set(setId: string, identifier: string, state: number, winnerId: string | null): SetSnapshot {
  return {
    setId,
    phaseGroupId: "group",
    identifier,
    fullRoundText: `Set ${identifier}`,
    round: Number(identifier),
    phaseName: "Final",
    phaseGroupName: "Pool 1",
    phaseOrder: 1,
    phaseGroupDisplayIdentifier: "1",
    state,
    winnerId,
    entrant1Source: null,
    entrant2Source: null,
    slots: [
      { entrantId: "player-1", entrantName: "Player 1", seedId: "seed-1", seedNum: 1, score: null },
      { entrantId: "player-2", entrantName: "Player 2", seedId: "seed-2", seedNum: 2, score: null },
    ],
  };
}

describe("FirstToNWinsBracket", () => {
  it("uses entrant aliases for First to N wins names when enabled", () => {
    const first = set("1", "1", 2, null);
    const renderBracket = (useAliasName: boolean) => renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 1,
          winsRequired: 1,
          playerOneEntrantId: "player-1",
          playAllMatches: true,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[first]}
        allSets={[first]}
        aliasNamesByEntrantId={{ "player-1": "Alias One", "player-2": "Alias Two" }}
        useAliasName={useAliasName}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );

    const aliased = renderBracket(true);
    expect(aliased).toContain("初期1P: Alias One / 2P: Alias Two");
    expect(aliased).toContain("Alias One 0 - 0 Alias Two");
    expect(aliased).toContain('title="Alias One">Alias One</span>');
    expect(aliased).toContain('title="Alias Two">Alias Two</span>');
    expect(aliased).not.toContain("Player 1");
    expect(aliased).not.toContain("Player 2");

    const originalNames = renderBracket(false);
    expect(originalNames).toContain("title=\"Player 1\">Player 1</span>");
    expect(originalNames).toContain("title=\"Player 2\">Player 2</span>");
  });

  it.each([
    { activeOverlaySetId: "1", busy: false, disabled: false },
    { activeOverlaySetId: null, busy: false, disabled: true },
    { activeOverlaySetId: "__test__", busy: false, disabled: true },
    { activeOverlaySetId: "other-event", busy: false, disabled: true },
    { activeOverlaySetId: "1", busy: true, disabled: true },
  ])("enables updating recorded time only for a streamed match ($activeOverlaySetId, busy=$busy)", ({
    activeOverlaySetId, busy, disabled,
  }) => {
    const first = set("1", "1", 2, null);
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 3, winsRequired: 2, playerOneEntrantId: "player-1",
          playAllMatches: false, drawCountsAsWin: false, suddenDeath: false,
        }}
        sets={[first]}
        allSets={[first]}
        activeOverlaySetId={activeOverlaySetId}
        streamStartUpdateDisabled={busy}
        onUpdateStreamStart={vi.fn()}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );
    const button = html.match(/<button[^>]*>記録時間を更新<\/button>/)?.[0];
    expect(button).toBeDefined();
    expect(button?.includes("disabled")).toBe(disabled);
  });
  it("numbers sets globally and only enables the next uncompleted match", () => {
    const first = set("1", "1", 3, "player-1");
    const second = set("2", "2", 1, null);
    const third = set("3", "3", 1, null);
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 3,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: false,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[third, first, second]}
        allSets={[first, second, third]}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );
    const buttons = html.match(/<button[^>]*class="[^"]*first-to-n-wins-match[^"]*"[^>]*>/g) ?? [];

    expect(html.indexOf("Set 1")).toBeLessThan(html.indexOf("Set 2"));
    expect(html.indexOf("Set 2")).toBeLessThan(html.indexOf("Set 3"));
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).not.toContain("disabled");
    expect(buttons[1]).not.toContain("disabled");
    expect(buttons[2]).toContain("disabled");
  });

  it("marks the currently streamed set with a live badge", () => {
    const first = set("1", "1", 2, null);
    const second = set("2", "2", 1, null);
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 2,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: true,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[first, second]}
        allSets={[first, second]}
        activeOverlaySetId="2"
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );

    expect(html).toContain('class="first-to-n-wins-match set-card-live"');
    expect(html).toContain('<span class="set-live-badge">配信中</span>');
  });

  it("highlights completed matches with a distinct frame class", () => {
    const completed = set("1", "1", 3, "player-1");
    const pending = set("2", "2", 1, null);
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 2,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: true,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[completed, pending]}
        allSets={[completed, pending]}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );
    const buttons = html.match(/<button[^>]*class="[^"]*first-to-n-wins-match[^"]*"[^>]*>/g) ?? [];

    expect(buttons[0]).toContain("first-to-n-wins-match-completed");
    expect(buttons[1]).not.toContain("first-to-n-wins-match-completed");
  });

  it("does not allow a completed later set to bypass the first uncompleted match", () => {
    const first = set("1", "1", 1, null);
    const skipped = set("2", "2", 3, "player-2");
    const third = set("3", "3", 1, null);
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 3,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: false,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[third, skipped, first]}
        allSets={[first, skipped, third]}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );
    const buttons = html.match(/<button[^>]*class="[^"]*first-to-n-wins-match[^"]*"[^>]*>/g) ?? [];

    expect(buttons).toHaveLength(3);
    expect(buttons[0]).not.toContain("disabled");
    expect(buttons[1]).toContain("disabled");
    expect(buttons[2]).toContain("disabled");
  });

  it("stops after the target is clinched unless all matches are requested", () => {
    const first = set("1", "1", 3, "player-1");
    const second = set("2", "2", 3, "player-1");
    const third = set("3", "3", 1, null);
    const renderBracket = (playAllMatches: boolean) => renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 3,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[first, second, third]}
        allSets={[first, second, third]}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );
    const defaultButtons = renderBracket(false).match(/<button[^>]*class="[^"]*first-to-n-wins-match[^"]*"[^>]*>/g) ?? [];
    const allMatchesButtons = renderBracket(true).match(/<button[^>]*class="[^"]*first-to-n-wins-match[^"]*"[^>]*>/g) ?? [];

    expect(defaultButtons[2]).toContain("disabled");
    expect(allMatchesButtons[2]).not.toContain("disabled");
  });

  it("counts a configured draw for both players and displays D", () => {
    const draw = set("1", "1", 3, null);
    const next = set("2", "2", 1, null);
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 1,
          winsRequired: 1,
          playerOneEntrantId: "player-1",
          playAllMatches: false,
          drawCountsAsWin: true,
          suddenDeath: true,
        }}
        sets={[draw, next]}
        allSets={[draw, next]}
        scaleStyle={{}}
        getSetSlotSide={(_setId, entrantId) => entrantId === "player-1" ? "2P" : "1P"}
        onActivateSet={vi.fn()}
      />,
    );
    const buttons = html.match(/<button[^>]*class="[^"]*first-to-n-wins-match[^"]*"[^>]*>/g) ?? [];

    expect(html).toContain("現在の勝利数: Player 1 1 - 1 Player 2");
    expect(html.match(/class="simple-games draw"/g)).toHaveLength(2);
    expect(html.match(/>D<\/span>/g)).toHaveLength(2);
    expect(html).toContain('class="side-badge side-2p">2P</span>');
    expect(html).toContain("Player 1</span>");
    expect(buttons[1]).not.toContain("disabled");
  });

  it("displays D for both players when draws do not count as wins", () => {
    const draw = set("1", "1", 3, null);
    const next = set("2", "2", 1, null);
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 1,
          winsRequired: 1,
          playerOneEntrantId: "player-1",
          playAllMatches: false,
          drawCountsAsWin: false,
          suddenDeath: true,
        }}
        sets={[draw, next]}
        allSets={[draw, next]}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );

    expect(html).toContain("現在の勝利数: Player 1 0 - 0 Player 2");
    expect(html.match(/class="simple-games draw"/g)).toHaveLength(2);
    expect(html.match(/>D<\/span>/g)).toHaveLength(2);
  });

  it("keeps long player names within the elimination-style card rows", () => {
    const longName = "A".repeat(80);
    const first = set("1", "1", 1, null);
    first.slots[0].entrantName = longName;
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 3,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: false,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[first]}
        allSets={[first]}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );

    expect(html).toContain(`title="${longName}"`);
    expect(html).toContain('class="first-to-n-wins-player-row"');
    expect(html).toContain('class="simple-player-name"');
  });

  it("shows W/L for directly-entered wins", () => {
    const completed = set("1", "1", 3, "player-1");
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 3,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: false,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[completed]}
        allSets={[completed]}
        directWinSetIds={new Set(["1"])}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );

    expect(html.match(/>W<\/span>/g)).toHaveLength(1);
    expect(html.match(/>L<\/span>/g)).toHaveLength(1);
  });

  it("announces the first player to clinch the target wins", () => {
    const first = set("1", "1", 3, "player-1");
    const second = set("2", "2", 3, "player-1");
    const third = set("3", "3", 3, "player-2");
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 3,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: true,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[first, second, third]}
        allSets={[first, second, third]}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );

    expect(html).toContain("勝者確定: Player 1");
  });

  it("does not announce a winner before either player reaches the target", () => {
    const first = set("1", "1", 3, "player-1");
    const second = set("2", "2", 3, "player-2");
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 3,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: false,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[first, second]}
        allSets={[first, second]}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );

    expect(html).not.toContain("勝者確定:");
  });

  it("does not offer bulk side swapping", () => {
    const first = set("1", "1", 3, "player-1");
    const second = set("2", "2", 1, null);
    const html = renderToStaticMarkup(
      <FirstToNWinsBracket
        settings={{
          phaseSetCount: 3,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: false,
          drawCountsAsWin: false,
          suddenDeath: false,
        }}
        sets={[first, second]}
        allSets={[first, second]}
        scaleStyle={{}}
        getSetSlotSide={() => ""}
        onActivateSet={vi.fn()}
      />,
    );

    expect(html).not.toContain("一括入替");
  });
});
