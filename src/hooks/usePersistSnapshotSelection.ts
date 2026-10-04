import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { EventSnapshot } from "../domain/bracketDisplay";
import { sameSnapshotEventKey } from "../domain/snapshotDisplay";
import {
  buildSnapshotSelectionPersistenceKey,
  resolveEventPhasePoolPersistence,
} from "../domain/snapshotSelectionPersistence";
import {
  saveEventPhasePoolSelection,
  saveLastSnapshotSelection,
  type LocalSnapshotEventListItem,
} from "../domain/tournamentWorkspaceRepository";

type UsePersistSnapshotSelectionOptions = {
  snapshot: { slug: string } | null;
  selectedEvent: EventSnapshot | null;
  selectedMessageScope: { phaseName: string; phaseGroupName: string } | null;
  selectedPhaseName: string;
  selectedPhasePoolKey: string;
  setLocalSnapshotEvents: Dispatch<SetStateAction<LocalSnapshotEventListItem[]>>;
  setError: (error: string) => void;
};

export function usePersistSnapshotSelection({
  snapshot,
  selectedEvent,
  selectedMessageScope,
  selectedPhaseName,
  selectedPhasePoolKey,
  setLocalSnapshotEvents,
  setError,
}: UsePersistSnapshotSelectionOptions) {
  const lastPersistedSnapshotSelectionRef = useRef("");
  const lastPersistedEventMetaPhasePoolRef = useRef("");

  useEffect(() => {
    if (!snapshot || !selectedEvent) {
      return;
    }

    const selectionKey = buildSnapshotSelectionPersistenceKey(
      snapshot.slug,
      selectedEvent.eventId,
      selectedMessageScope?.phaseName,
      selectedMessageScope?.phaseGroupName,
    );
    if (selectionKey === null) {
      return;
    }

    if (selectionKey === lastPersistedSnapshotSelectionRef.current) {
      return;
    }

    lastPersistedSnapshotSelectionRef.current = selectionKey;
    void saveLastSnapshotSelection({
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
      phaseName: selectedMessageScope?.phaseName ?? null,
      phaseGroupName: selectedMessageScope?.phaseGroupName ?? null,
    }).catch((err) => {
      lastPersistedSnapshotSelectionRef.current = "";
      setError(String(err));
    });
  }, [selectedEvent, selectedMessageScope, snapshot, setError]);

  useEffect(() => {
    if (!snapshot || !selectedEvent) {
      return;
    }

    const persistence = resolveEventPhasePoolPersistence(
      snapshot,
      selectedEvent,
      selectedPhaseName,
      selectedPhasePoolKey,
    );
    if (!persistence) {
      return;
    }

    if (persistence.persistenceKey === lastPersistedEventMetaPhasePoolRef.current) {
      return;
    }

    lastPersistedEventMetaPhasePoolRef.current = persistence.persistenceKey;
    setLocalSnapshotEvents((current) => current.map((item) => {
      if (!sameSnapshotEventKey(item.slug, item.eventId, snapshot.slug, selectedEvent.eventId)) {
        return item;
      }

      return {
        ...item,
        lastSelectedPhaseName: persistence.phaseName,
        lastSelectedPhaseGroupName: persistence.phaseGroupName,
      };
    }));

    void saveEventPhasePoolSelection({
      slug: persistence.slug,
      eventId: persistence.eventId,
      eventName: persistence.eventName,
      phaseName: persistence.phaseName,
      phaseGroupName: persistence.phaseGroupName,
    }).catch((err) => {
      lastPersistedEventMetaPhasePoolRef.current = "";
      setError(String(err));
    });
  }, [selectedEvent, selectedPhaseName, selectedPhasePoolKey, setError, setLocalSnapshotEvents, snapshot]);

  return {
    resetLastPersistedSnapshotSelection() {
      lastPersistedSnapshotSelectionRef.current = "";
    },
  };
}