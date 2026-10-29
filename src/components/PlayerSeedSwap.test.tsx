import { describe, expect, it, vi } from "vitest";
import type { DragEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerSeedSwapTarget, PlayerSeedSwapToggle, type PlayerSeedSwapControls } from "./PlayerSeedSwap";

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: () => [false, vi.fn()],
}));

function controls(): PlayerSeedSwapControls {
  return {
    active: true, available: true, busy: false, eventId: "event",
    positions: [
      { entrantId: "a", phaseGroupId: "pool-1", poolName: "1", seedNum: 1 },
      { entrantId: "b", phaseGroupId: "pool-1", poolName: "1", seedNum: 2 },
      { entrantId: "c", phaseGroupId: "pool-2", poolName: "2", seedNum: 1 },
    ],
    onToggle: vi.fn(), onSwap: vi.fn(),
  };
}

function dropEvent(payload: unknown) {
  const data = new Map<string, string>([["application/x-savakan-player-seed", JSON.stringify(payload)]]);
  return {
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
    dataTransfer: {
      effectAllowed: "none", types: [...data.keys()],
      getData: (type: string) => data.get(type) ?? "",
      setData: (type: string, value: string) => data.set(type, value),
    },
  };
}

describe("player seed drag and drop", () => {
  it("explains remote seed reporting without claiming automatic byes are eligible", () => {
    const html = renderToStaticMarkup(
      <PlayerSeedSwapToggle controls={{ ...controls(), active: false, requiresSeedReport: true }} />,
    );
    expect(html).toContain("未報告の試合結果がない場合");
    expect(html).toContain("結果報告でSeed変更をstart.ggへ反映");
    expect(html).not.toContain("不戦勝は開始済みに含みません");
  });
  it("moves player identities and supports cross-pool swaps in the player list", () => {
    const swap = controls();
    const source = PlayerSeedSwapTarget({ controls: swap, entrantId: "a", children: "A" });
    const event = dropEvent(null);
    source.props.onDragStart(event as unknown as DragEvent<HTMLDivElement>);
    const target = PlayerSeedSwapTarget({ controls: swap, entrantId: "c", children: "C" });
    target.props.onDrop(event as unknown as DragEvent<HTMLDivElement>);
    expect(swap.onSwap).toHaveBeenCalledWith("a", "c");
  });

  it("restricts bracket swaps to the same pool", () => {
    const swap = controls();
    const target = PlayerSeedSwapTarget({ controls: swap, entrantId: "b", samePoolOnly: true, children: "B" });
    target.props.onDrop(dropEvent({ eventId: "event", entrantId: "c" }) as unknown as DragEvent<HTMLDivElement>);
    expect(swap.onSwap).not.toHaveBeenCalled();
    target.props.onDrop(dropEvent({ eventId: "event", entrantId: "a" }) as unknown as DragEvent<HTMLDivElement>);
    expect(swap.onSwap).toHaveBeenCalledWith("a", "b");
  });

  it.each([
    { eventId: "other-event", entrantId: "a" },
    { eventId: "event", entrantId: "b" },
    { eventId: "event", entrantId: "missing" },
    null,
  ])("ignores stale, self, and invalid drags: %j", (payload) => {
    const swap = controls();
    const target = PlayerSeedSwapTarget({ controls: swap, entrantId: "b", children: "B" });
    target.props.onDrop(dropEvent(payload) as unknown as DragEvent<HTMLDivElement>);
    expect(swap.onSwap).not.toHaveBeenCalled();
  });

  it.each([{ active: false }, { busy: true }])("disables dragging and dropping outside an idle swap mode: %j", (state) => {
    const swap = { ...controls(), ...state };
    const target = PlayerSeedSwapTarget({ controls: swap, entrantId: "b", children: "B" });
    expect(target.props.draggable).toBe(false);
    target.props.onDrop(dropEvent({ eventId: "event", entrantId: "a" }) as unknown as DragEvent<HTMLDivElement>);
    expect(swap.onSwap).not.toHaveBeenCalled();
  });

  it("does not allow dragging placeholders or unknown players", () => {
    expect(PlayerSeedSwapTarget({ controls: controls(), entrantId: null, children: "TBD" }).props.draggable).toBe(false);
  });

  it("disables mode activation after scoring", () => {
    const toggle = PlayerSeedSwapToggle({ controls: { ...controls(), available: false } });
    expect(toggle?.props.children[0].props.disabled).toBe(true);
  });
});
