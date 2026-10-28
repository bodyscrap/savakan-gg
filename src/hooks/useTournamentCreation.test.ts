import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listLocalSnapshotEvents, persistLocalEventSnapshot, type CreateLocalEventSnapshotInput,
  type LocalSnapshotEventListItem } from "../domain/tournamentWorkspaceRepository";
import { defaultLocalEventRegistration } from "../domain/localEventRegistration";
import { useTournamentCreation } from "./useTournamentCreation";

vi.mock("react", () => ({
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useEffect: vi.fn(),
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("../i18n", async (importOriginal) => ({
  ...await importOriginal<typeof import("../i18n")>(), useLanguage: () => "ja",
}));
vi.mock("../domain/tournamentWorkspaceRepository", () => ({
  listLocalSnapshotEvents: vi.fn(), persistLocalEventSnapshot: vi.fn(),
  persistEventSnapshot: vi.fn(), loadStartggCreateSlug: vi.fn(), saveStartggCreateSlug: vi.fn(),
}));

const input: CreateLocalEventSnapshotInput = {
  tournamentName: " Tournament ", eventName: " Event ", eventAlias: null, participants: [],
  requireItemSelections: false, eventManagement: defaultLocalEventRegistration().setting, phases: [],
};
const existing: LocalSnapshotEventListItem = {
  tournamentId: "local-12345678-1", slug: "local-12345678-1", eventId: "local-12345678-1-event",
  tournamentName: "Tournament", eventName: "Event", origin: "local", eventAlias: null,
  updatedAt: "2026-10-28T00:00:00Z", setCount: 1,
};

function setup() {
  const options = { perPage: 100, setCreateBusy: vi.fn(), setBusy: vi.fn(),
    setError: vi.fn(), setMessage: vi.fn(), onSnapshotCreated: vi.fn().mockResolvedValue(undefined) };
  return { ...useTournamentCreation(options), ...options };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { confirm: vi.fn().mockReturnValue(false), localStorage: { getItem: () => null } });
  vi.mocked(listLocalSnapshotEvents).mockResolvedValue([]);
  vi.mocked(persistLocalEventSnapshot).mockResolvedValue({} as Awaited<ReturnType<typeof persistLocalEventSnapshot>>);
});
afterEach(() => vi.unstubAllGlobals());

describe("local event overwrite confirmation", () => {
  it("creates a new event without confirmation when the name pair is unused", async () => {
    const creation = setup();
    await creation.createLocalEventSnapshot(input);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(persistLocalEventSnapshot).toHaveBeenCalledWith({ ...input, overwriteEventId: undefined });
    expect(creation.onSnapshotCreated).toHaveBeenCalledOnce();
  });

  it("does not write or refresh when the overwrite warning is cancelled", async () => {
    vi.mocked(listLocalSnapshotEvents).mockResolvedValue([existing]);
    const creation = setup();
    await creation.createLocalEventSnapshot(input);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("元に戻せません"));
    expect(persistLocalEventSnapshot).not.toHaveBeenCalled();
    expect(creation.onSnapshotCreated).not.toHaveBeenCalled();
    expect(creation.setCreateBusy).toHaveBeenLastCalledWith(false);
  });

  it("sends only the confirmed existing event ID for overwrite", async () => {
    vi.mocked(listLocalSnapshotEvents).mockResolvedValue([existing]);
    vi.mocked(window.confirm).mockReturnValue(true);
    await setup().createLocalEventSnapshot(input);
    expect(persistLocalEventSnapshot).toHaveBeenCalledWith({ ...input, overwriteEventId: existing.eventId });
  });

  it.each(["startgg", undefined] as const)("ignores non-local events with the same names (%s)", async (origin) => {
    vi.mocked(listLocalSnapshotEvents).mockResolvedValue([{ ...existing, origin }]);
    await setup().createLocalEventSnapshot(input);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(persistLocalEventSnapshot).toHaveBeenCalledWith({ ...input, overwriteEventId: undefined });
  });

  it("blocks ambiguous existing duplicates without choosing an overwrite target", async () => {
    vi.mocked(listLocalSnapshotEvents).mockResolvedValue([existing, { ...existing, eventId: "other" }]);
    const creation = setup();
    await creation.createLocalEventSnapshot(input);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(persistLocalEventSnapshot).not.toHaveBeenCalled();
    expect(creation.setError).toHaveBeenCalledWith(expect.stringContaining("複数あります"));
  });

  it("does not create an unchecked event when listing existing events fails", async () => {
    vi.mocked(listLocalSnapshotEvents).mockRejectedValueOnce(new Error("List failed"));
    const creation = setup();
    await creation.createLocalEventSnapshot(input);
    expect(persistLocalEventSnapshot).not.toHaveBeenCalled();
    expect(creation.setError).toHaveBeenCalledWith("Error: List failed");
    expect(creation.setCreateBusy).toHaveBeenLastCalledWith(false);
  });
});