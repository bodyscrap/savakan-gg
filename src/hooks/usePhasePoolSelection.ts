import { useEffect } from "react";
import type { PhasePoolGroup } from "../domain/bracketDisplay";
import { parsePhasePoolKey } from "../domain/messageUtils";

export function resolveSelectedPhaseName(phaseNames: string[], selectedPhaseName: string): string {
  if (phaseNames.length === 0) {
    return "";
  }

  return phaseNames.includes(selectedPhaseName) ? selectedPhaseName : phaseNames[0];
}

export function resolveSelectedPhasePoolKey(
  phaseScopedPoolGroups: PhasePoolGroup[],
  selectedPhasePoolKey: string,
): string {
  if (phaseScopedPoolGroups.length === 0) {
    return "";
  }

  if (phaseScopedPoolGroups.some((group) => group.key === selectedPhasePoolKey)) {
    return selectedPhasePoolKey;
  }

  const savedNames = parsePhasePoolKey(selectedPhasePoolKey);
  if (savedNames) {
    const savedGroup = phaseScopedPoolGroups.find((group) =>
      group.phaseName === savedNames.phaseName
      && group.phaseGroupName === savedNames.phaseGroupName,
    );
    if (savedGroup) {
      return savedGroup.key;
    }
  }

  return phaseScopedPoolGroups[0].key;
}

type UsePhasePoolSelectionOptions = {
  phaseNames: string[];
  phaseScopedPoolGroups: PhasePoolGroup[];
  selectedPhaseName: string;
  selectedPhasePoolKey: string;
  setSelectedPhaseName: (phaseName: string) => void;
  setSelectedPhasePoolKey: (key: string) => void;
};

export function usePhasePoolSelection({
  phaseNames,
  phaseScopedPoolGroups,
  selectedPhaseName,
  selectedPhasePoolKey,
  setSelectedPhaseName,
  setSelectedPhasePoolKey,
}: UsePhasePoolSelectionOptions) {
  useEffect(() => {
    const nextPhaseName = resolveSelectedPhaseName(phaseNames, selectedPhaseName);
    if (nextPhaseName !== selectedPhaseName) {
      setSelectedPhaseName(nextPhaseName);
    }
  }, [phaseNames, selectedPhaseName, setSelectedPhaseName]);

  useEffect(() => {
    const nextPhasePoolKey = resolveSelectedPhasePoolKey(phaseScopedPoolGroups, selectedPhasePoolKey);
    if (nextPhasePoolKey !== selectedPhasePoolKey) {
      setSelectedPhasePoolKey(nextPhasePoolKey);
    }
  }, [phaseScopedPoolGroups, selectedPhasePoolKey, setSelectedPhasePoolKey]);
}