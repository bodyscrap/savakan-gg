import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useBracketReport } from "./useBracketReport";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react", () => ({
  useState: (initial: unknown) => [initial, vi.fn()],
  useMemo: (compute: () => unknown) => compute(),
  useEffect: () => {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue({
    workspace: {}, completed: true, processedCount: 1, reportedCount: 1, skippedCount: 0,
    conflict: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("report confirmation timing", () => {
  it.each([
    { seeds: false, confirmed: false },
    { seeds: false, confirmed: true },
    { seeds: true, confirmed: false },
    { seeds: true, confirmed: true },
  ])("waits for confirmation before reporting: %j", async ({ seeds, confirmed }) => {
    let answer!: (value: boolean) => void;
    vi.stubGlobal("window", {
      confirm: vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; })),
    });
    const options = {
      slug: "tournament/test", eventId: "event", perPage: 100, reportableCount: 1,
      hasUnreportedSeedShuffle: seeds, seedStatusLoading: false, seedSnapshotRefreshRequired: false,
      setWorkspace: vi.fn(), closeMatchDialog: vi.fn(), setBusy: vi.fn(),
      setError: vi.fn(), setMessage: vi.fn(), clearSnapshotProgress: vi.fn(),
      onSeedShuffleReported: vi.fn(),
    };
    const operation = useBracketReport(options).startReport();
    expect(invoke).not.toHaveBeenCalled();
    expect(options.setBusy).not.toHaveBeenCalled();
    expect(options.setWorkspace).not.toHaveBeenCalled();
    answer(confirmed);
    await operation;
    expect(invoke).toHaveBeenCalledTimes(confirmed ? 1 : 0);
    expect(options.setWorkspace).toHaveBeenCalledTimes(confirmed ? 1 : 0);
    expect(options.onSeedShuffleReported).toHaveBeenCalledTimes(confirmed && seeds ? 1 : 0);
  });
});
