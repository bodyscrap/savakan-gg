import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateLocalEventSnapshotInput, LocalEventPhaseConfig } from "../domain/tournamentWorkspaceRepository";
import { setLanguage } from "../i18n";
import { CreateSnapshot } from "./CreateSnapshot";
import { defaultLocalEventRegistration } from "../domain/localEventRegistration";

vi.mock("react", { spy: true });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setLanguage("ja");
});

function renderLocalPhases(
  phaseCount: number,
  bracketType: LocalEventPhaseConfig["bracketType"],
  playersPerPool: number,
  poolCount = 1,
): string {
  mockLocalPhaseState(phaseCount, bracketType, playersPerPool, poolCount);
  return renderToStaticMarkup(snapshotElement());
}

function mockLocalPhaseState(
  phaseCount: number,
  bracketType: LocalEventPhaseConfig["bracketType"],
  playersPerPool: number,
  poolCount = 1,
  checked = true,
  requireItemSelections = true,
  selectionsConfirmed = true,
  grandFinalReset = true,
) {
  const phases: LocalEventPhaseConfig[] = Array.from({ length: 3 }, (_, index) => ({
    name: `Custom phase ${index + 1}`,
    poolCount: index + 1 === phaseCount ? poolCount : 1,
    bracketType,
    qualifiersPerPool: playersPerPool * poolCount,
    tiebreakOrder: ["TOTAL_SETS_WON", "GAME_RATIO", "HEAD_TO_HEAD"],
    enabledTiebreakRules: ["TOTAL_SETS_WON", "GAME_RATIO", "HEAD_TO_HEAD"],
    thirdPlaceMatch: checked,
    fifthPlaceMatch: checked,
    grandFinalReset,
  }));
  const states: unknown[] = [
    "local", "Tournament", "Event", "Alias", false,
    {
      ...defaultLocalEventRegistration(),
      requireItemSelections,
      participants: Array.from({ length: phaseCount === 1 ? playersPerPool * poolCount : 32 }, (_, index) => ({
        entrantId: `player-${index}`, name: `Player ${index}`, categorySelections: [[], [], []], selectionsConfirmed,
      })),
    },
    phaseCount, null, phases, false,
  ];
  for (const state of states) {
    vi.mocked(React.useState).mockImplementationOnce(() => [state, vi.fn()]);
  }
}

function snapshotElement() {
  return <CreateSnapshot
    itemLists={[]}
    token="" onTokenChange={vi.fn()}
    createTournamentSlug="" onCreateTournamentSlugChange={vi.fn()}
    createBusy={false} canLoadPreview={false}
    onSaveToken={vi.fn()} onLoadPreview={vi.fn()}
    createPreview={null} createPreviewLoadFailed={false}
    createEventSearchInput="" onEventSearchInputChange={vi.fn()}
    createFilteredEvents={[]} createSelectedEventId="" onEventDropdownChange={vi.fn()}
    createEventAlias="" onEventAliasChange={vi.fn()}
    canCreateSnapshot={false} onCreateSnapshot={vi.fn()}
    senderUserId="sender" canCreateLocalSnapshot onCreateLocalSnapshot={vi.fn()}
  />;
}

describe("snapshot creation defaults", () => {
  const storageKey = "savakan-gg.snapshot-source.v1";

  it("places the compact phase count after the name fields without a redundant participant count", () => {
    const html = renderLocalPhases(1, "DOUBLE_ELIMINATION", 8);
    expect(html).toMatch(/class="local-event-name-fields">[\s\S]*tournament名[\s\S]*event名[\s\S]*エイリアス名[\s\S]*class="local-event-phase-count-field">フェーズ数<select/);
    expect(html).not.toContain("local-event-size-fields");
    expect(html).not.toContain("参加人数:");
    expect(html).toContain("参加者一覧(8 人)");
  });

  it.each(["startgg", "local"] as const)("restores the saved %s creation method", (source) => {
    const getItem = vi.fn(() => source);
    vi.stubGlobal("window", { localStorage: { getItem } });
    const html = renderToStaticMarkup(snapshotElement());
    expect(getItem).toHaveBeenCalledWith(storageKey);
    expect(html).toContain(source === "local"
      ? '<input type="radio" checked=""/> ローカルeventを作成する'
      : '<input type="radio" checked=""/> start.ggからeventを取り込む');
  });

  it("defaults to start.gg when no preference has been saved", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    expect(renderToStaticMarkup(snapshotElement())).toContain(
      '<input type="radio" checked=""/> start.ggからeventを取り込む',
    );
  });

  it.each(["invalid", "unavailable"])("reports %s storage and keeps the default usable", (mode) => {
    const error = new Error("Storage unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", { localStorage: {
      getItem: () => {
        if (mode === "unavailable") throw error;
        return "invalid";
      },
    } });
    expect(renderToStaticMarkup(snapshotElement())).toContain(
      '<input type="radio" checked=""/> start.ggからeventを取り込む',
    );
    expect(report).toHaveBeenCalledWith(
      mode === "invalid" ? "Invalid stored snapshot source preference." : "Unable to read the snapshot source preference.",
      mode === "invalid" ? "invalid" : error,
    );
  });

  it.each(["startgg", "local"] as const)("saves %s immediately when selected", (source) => {
    const setItem = vi.fn();
    const setSource = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem } });
    vi.mocked(React.useState).mockImplementationOnce(() => ["startgg", setSource]);
    const tree = CreateSnapshot(snapshotElement().props);
    const radios = tree.props.children[0].props.children[1].props.children;
    radios[source === "startgg" ? 0 : 1].props.children[0].props.onChange();
    expect(setSource).toHaveBeenCalledWith(source);
    expect(setItem).toHaveBeenCalledWith(storageKey, source);
  });

  it("reports saving failures while still updating the current selection", () => {
    const error = new Error("Storage unavailable");
    const setSource = vi.fn();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", { localStorage: { setItem: () => { throw error; } } });
    vi.mocked(React.useState).mockImplementationOnce(() => ["startgg", setSource]);
    const tree = CreateSnapshot(snapshotElement().props);
    tree.props.children[0].props.children[1].props.children[1].props.children[0].props.onChange();
    expect(setSource).toHaveBeenCalledWith("local");
    expect(report).toHaveBeenCalledWith("Unable to save the snapshot source preference.", error);
  });

  it("prefixes the default event name and alias with the local date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 23, 45));
    vi.stubGlobal("window", { localStorage: { getItem: () => "local" } });
    const html = renderToStaticMarkup(snapshotElement());
    expect(html).toContain('value="2026-01-02 Local Event"');
    expect(html).toContain('value="Local Tournament / 2026-01-02 Local Event"');
    expect(html).not.toContain("Local Event 2026-01-02");
    expect(html).toContain('<input type="checkbox" checked=""/>GF Reset');
  });
});

describe("local event phase settings", () => {
  it.each([false, true])("submits GF Reset=%s for all double-elimination phases", (enabled) => {
    vi.mocked(React.useEffect).mockImplementation(() => {});
    mockLocalPhaseState(3, "DOUBLE_ELIMINATION", 8, 1, false, true, true, enabled);
    const onCreate = vi.fn<(input: CreateLocalEventSnapshotInput) => void>();
    const tree = CreateSnapshot({ ...snapshotElement().props, onCreateLocalSnapshot: onCreate });
    const localForm = tree.props.children[2];
    const form = localForm.type(localForm.props);
    const html = renderToStaticMarkup(form);
    expect(html.match(new RegExp(`<input type="checkbox"${enabled ? ' checked=""' : ""}/>GF Reset`, "g")))
      .toHaveLength(3);
    form.props.children[2].props.children[2].props.children.props.onClick();
    expect(onCreate.mock.calls[0][0].phases.map((phase) => phase.grandFinalReset)).toEqual([enabled, enabled, enabled]);
  });

  it.each(["SINGLE_ELIMINATION", "ROUND_ROBIN"] as const)("does not show GF Reset for %s", (type) => {
    expect(renderLocalPhases(1, type, 8)).not.toContain("GF Reset");
  });

  it.each([false, true])("gates creation of incomplete registrations when required=%s", (required) => {
    mockLocalPhaseState(1, "DOUBLE_ELIMINATION", 8, 1, false, required, false);
    const html = renderToStaticMarkup(snapshotElement());
    expect(html).toContain(required
      ? '<button type="button" disabled="">ローカルeventを作成</button>'
      : '<button type="button">ローカルeventを作成</button>');
    expect(html).toContain("選択未完了");
  });

  describe.each([1, 2, 3])("creation with %i phase(s)", (phaseCount) => {
    it.each([
      ["SINGLE_ELIMINATION", 4, "thirdPlaceMatch"],
      ["DOUBLE_ELIMINATION", 8, "fifthPlaceMatch"],
    ] as const)("requires both the %s option and enough participants per pool", (bracketType, minimum, field) => {
      vi.mocked(React.useEffect).mockImplementation(() => {});
      for (const checked of [false, true]) {
        for (const players of [minimum - 1, minimum, minimum + 1]) {
          mockLocalPhaseState(phaseCount, bracketType, players, 2, checked);
          const onCreate = vi.fn<(input: CreateLocalEventSnapshotInput) => void>();
          const tree = CreateSnapshot({ ...snapshotElement().props, onCreateLocalSnapshot: onCreate });
          const localForm = tree.props.children[2];
          const form = localForm.type(localForm.props);
          form.props.children[2].props.children[2].props.children.props.onClick();
          expect(onCreate).toHaveBeenCalledOnce();
          const submitted = onCreate.mock.calls[0][0];
          expect(submitted.participants).toHaveLength(phaseCount === 1 ? players * 2 : 32);
          expect(submitted.participants[0].name).toBe("Player 0");
          expect(submitted).not.toHaveProperty("participantCount");
          expect(submitted.eventManagement).toEqual(defaultLocalEventRegistration().setting);
          expect(submitted.requireItemSelections).toBe(true);
          expect(submitted.phases).toHaveLength(phaseCount);
          for (const [index, phase] of submitted.phases.entries()) {
            const expected = index + 1 === phaseCount && checked && players >= minimum;
            expect(phase[field]).toBe(expected);
            expect(phase[field === "thirdPlaceMatch" ? "fifthPlaceMatch" : "thirdPlaceMatch"]).toBe(false);
          }
        }
      }
    });
  });

  it("places each phase number immediately before the name input without a fieldset", () => {
    const html = renderLocalPhases(3, "DOUBLE_ELIMINATION", 8);
    expect(html).not.toContain('<fieldset class="local-event-phase"');
    expect(html).not.toContain("<legend");
    for (let phase = 1; phase <= 3; phase += 1) {
      expect(html).toContain(`role="group" aria-label="Phase ${phase}"`);
      expect(html).toContain(`class="local-event-phase-number">Phase ${phase} (${phase === 1 ? 32 : 8})</strong><input aria-label="フェーズ名" value="Custom phase ${phase}"`);
    }
  });

  it("shows column headings only once above all phase inputs", () => {
    const html = renderLocalPhases(3, "DOUBLE_ELIMINATION", 8);
    expect(html.match(/local-event-phase-header/g)).toHaveLength(1);
    for (const heading of ["フェーズ名", "プール数", "形式", "進出人数"]) {
      expect(html.match(new RegExp(`<span>${heading}</span>`, "g"))).toHaveLength(1);
      expect(html).not.toContain(`<label>${heading}`);
    }
  });

  it("shows the total participants rather than the per-pool count beside each phase", () => {
    const html = renderLocalPhases(3, "DOUBLE_ELIMINATION", 8, 2);
    expect(html).toContain('class="local-event-phase-number">Phase 1 (32)</strong>');
    expect(html).toContain('class="local-event-phase-number">Phase 2 (16)</strong>');
    expect(html).toContain('class="local-event-phase-number">Phase 3 (16)</strong>');
  });

  describe.each([1, 2, 3])("%i phase(s)", (phaseCount) => {
    it.each([
      ["SINGLE_ELIMINATION", 4, "3位決定戦"],
      ["DOUBLE_ELIMINATION", 8, "5位決定戦"],
    ] as const)("shows %s placement matches only for the final phase", (bracketType, minimum, label) => {
      const html = renderLocalPhases(phaseCount, bracketType, minimum);
      expect(html.match(/class="local-event-phase-option-field"/g)).toHaveLength(bracketType === "DOUBLE_ELIMINATION" ? phaseCount + 1 : 1);
      expect(html).toContain(`<input type="checkbox" checked=""/>${label}`);
      const finalPhaseStart = html.indexOf(`role="group" aria-label="Phase ${phaseCount}"`);
      expect(html.indexOf(`/>${label}`)).toBeGreaterThan(finalPhaseStart);
    });

    it.each([
      ["SINGLE_ELIMINATION", 4, "3位決定戦"],
      ["DOUBLE_ELIMINATION", 8, "5位決定戦"],
    ] as const)("keeps %s options visible but disabled below the per-pool minimum", (bracketType, minimum, label) => {
      const html = renderLocalPhases(phaseCount, bracketType, minimum - 1, 2);
      expect(html).toContain(`<input type="checkbox" disabled=""/>${label}`);
      expect(html).toContain(`title="各プールに${minimum}人以上必要です。"`);
      expect(html).not.toMatch(new RegExp(`type="checkbox"[^>]*checked=""[^>]*\\/>${label}`));
    });

    it("does not offer placement matches for a round-robin final", () => {
      const html = renderLocalPhases(phaseCount, "ROUND_ROBIN", 8);
      expect(html).not.toContain('class="local-event-phase-option-field"');
      expect(html).not.toContain("3位決定戦");
      expect(html).not.toContain("5位決定戦");
      expect(html.match(/class="local-event-tiebreak"/g)).toHaveLength(phaseCount);
    });
  });

  it("translates the disabled option explanation", () => {
    setLanguage("en");
    const html = renderLocalPhases(3, "DOUBLE_ELIMINATION", 7);
    expect(html).toContain('title="Each pool requires at least 8 participants."');
    expect(html).toContain('<input type="checkbox" disabled=""/>Fifth-place match');
  });
});
