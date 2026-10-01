import { useEffect, useMemo, useState } from "react";
import type { EventSnapshot } from "./bracketDisplay";
import {
  filterLocalSnapshotEvents,
  findSelectedLocalSnapshotEvent,
  findSnapshotEventByIdentity,
  resolveSelectedSnapshotName,
} from "./snapshotDisplay";
import type { LocalSnapshotEventListItem, TournamentSnapshot } from "./tournamentWorkspaceRepository";
import type { EventLocalMeta } from "./useTournamentWorkspace";

type UseSnapshotSelectionViewOptions = {
  localSnapshotEvents: LocalSnapshotEventListItem[];
  snapshot: TournamentSnapshot | null;
  selectedEvent: EventSnapshot | null;
  selectedEventMeta: EventLocalMeta | null;
  selectedEventId: string;
  setSelectedEventId: (eventId: string) => void;
  startupSavedSlugRef: { current: string };
  startupSavedEventIdRef: { current: string };
};

export function useSnapshotSelectionView({
  localSnapshotEvents,
  snapshot,
  selectedEvent,
  selectedEventMeta,
  selectedEventId,
  setSelectedEventId,
  startupSavedSlugRef,
  startupSavedEventIdRef,
}: UseSnapshotSelectionViewOptions) {
  const [homeSnapshotSearchInput, setHomeSnapshotSearchInput] = useState("");
  const [homeSelectedSnapshotKey, setHomeSelectedSnapshotKey] = useState("");

  const selectedSummaryName = useMemo(() => {
    const startupSelectedSlug = startupSavedSlugRef.current.trim();
    const startupSelectedEventId = startupSavedEventIdRef.current.trim();
    const currentSelectedSlug = snapshot?.slug?.trim() || startupSelectedSlug;
    const currentSelectedEventId = selectedEventId.trim() || startupSelectedEventId;
    return resolveSelectedSnapshotName(localSnapshotEvents, {
      eventAlias: selectedEventMeta?.eventAlias,
      eventName: selectedEvent?.name,
      slug: currentSelectedSlug,
      eventId: currentSelectedEventId,
      fallbackName: snapshot?.name ?? "未選択",
    });
  }, [localSnapshotEvents, selectedEventMeta, selectedEvent, selectedEventId, snapshot]);

  const selectedSidebarItem = useMemo(() => {
    const startupSelectedSlug = startupSavedSlugRef.current.trim();
    const startupSelectedEventId = startupSavedEventIdRef.current.trim();
    const currentSelectedSlug = snapshot?.slug?.trim() || startupSelectedSlug;
    const currentSelectedEventId = selectedEvent?.eventId?.trim() || selectedEventId.trim() || startupSelectedEventId;

    if (currentSelectedSlug === "" || currentSelectedEventId === "") {
      return null;
    }

    return findSnapshotEventByIdentity(localSnapshotEvents, currentSelectedSlug, currentSelectedEventId);
  }, [localSnapshotEvents, selectedEvent, selectedEventId, snapshot]);

  const homeFilteredSnapshotEvents = useMemo(() => {
    return filterLocalSnapshotEvents(localSnapshotEvents, homeSnapshotSearchInput);
  }, [homeSnapshotSearchInput, localSnapshotEvents]);

  const homeSelectedSnapshotItem = useMemo(() => {
    return findSelectedLocalSnapshotEvent(homeFilteredSnapshotEvents, homeSelectedSnapshotKey);
  }, [homeFilteredSnapshotEvents, homeSelectedSnapshotKey]);

  useEffect(() => {
    if (localSnapshotEvents.length === 0) {
      if (homeSelectedSnapshotKey !== "") {
        setHomeSelectedSnapshotKey("");
      }
      return;
    }

    if (homeSelectedSnapshotKey !== "" && !findSelectedLocalSnapshotEvent(localSnapshotEvents, homeSelectedSnapshotKey)) {
      setHomeSelectedSnapshotKey("");
    }
  }, [homeSelectedSnapshotKey, localSnapshotEvents]);

  useEffect(() => {
    if (!snapshot || snapshot.events.length === 0 || selectedEventId === "") {
      return;
    }

    if (!snapshot.events.some((event) => event.eventId === selectedEventId)) {
      setSelectedEventId("");
    }
  }, [snapshot, selectedEventId]);

  return {
    homeSnapshotSearchInput,
    setHomeSnapshotSearchInput,
    homeSelectedSnapshotKey,
    setHomeSelectedSnapshotKey,
    homeFilteredSnapshotEvents,
    homeSelectedSnapshotItem,
    selectedSummaryName,
    selectedSidebarItem,
  };
}