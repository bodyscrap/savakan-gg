import { useEffect, useRef, useState } from "react";
import { clampNonNegativeInteger, emptyCategorySelections } from "../domain/eventManagement";
import type { EventSettingCategorySlot } from "../components/EventSetting";
import type { EventSnapshot } from "../domain/bracketDisplay";
import { MAX_CATEGORY_SLOTS, resolveEventItemList, type ItemListConfig } from "../domain/itemList";
import { toApiSlug } from "../domain/slugUtils";
import type { EventLocalMeta, PlaySide } from "./useTournamentWorkspace";

type PlayerMetaDraft = {
  aliasName: string;
  playSide: PlaySide | "";
  categorySelections: string[][];
};

type Entrant = {
  entrantId: string;
  entrantName: string;
};

type SavePlayerMetaOptions = {
  silent?: boolean;
  manageBusy?: boolean;
};

type UsePlayerMetaDraftsOptions = {
  selectedEvent: EventSnapshot | null;
  selectedEventMeta: EventLocalMeta | null;
  selectedEventEntrants: Entrant[];
  selectedEntrant: Entrant | null;
  categorySlotListIds: string[];
  categorySlotAllowDuplicates: boolean[];
  totalItemMinCount: number;
  totalItemMaxCount: number;
  itemLists: ItemListConfig[];
  selectedEventItemListSnapshots: ItemListConfig[];
  slug: string;
  configuredCategorySlots: EventSettingCategorySlot[];
  saveLocalPlayerMeta: (input: {
    slug: string;
    eventId: string;
    eventName: string;
    entrantId: string;
    entrantName: string;
    aliasName: string;
    playSide: null;
    characterNames: string[];
    notes: null;
  }) => Promise<unknown>;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
};

export function usePlayerMetaDrafts({
  selectedEvent,
  selectedEventMeta,
  selectedEventEntrants,
  selectedEntrant,
  categorySlotListIds,
  categorySlotAllowDuplicates,
  totalItemMinCount,
  totalItemMaxCount,
  itemLists,
  selectedEventItemListSnapshots,
  slug,
  configuredCategorySlots,
  saveLocalPlayerMeta,
  setBusy,
  setError,
  setMessage,
}: UsePlayerMetaDraftsOptions) {
  const [metaDrafts, setMetaDrafts] = useState<Record<string, PlayerMetaDraft>>({});
  const dirtyMetaDraftKeysRef = useRef(new Set<string>());

  function getMetaDraftKey(eventId: string, entrantId: string): string {
    return `${eventId}:${entrantId}`;
  }

  function findEntrantMeta(eventId: string, entrantId: string) {
    return selectedEventMeta?.eventId === eventId
      ? selectedEventMeta.entrants.find((entrant) => entrant.entrantId === entrantId)
      : undefined;
  }

  function resolveItemList(listId: string): ItemListConfig | null {
    return resolveEventItemList(listId, selectedEventItemListSnapshots, itemLists);
  }

  function buildInitialCategorySelections(characterNames: string[]): string[][] {
    const categorySelections = emptyCategorySelections();
    const remaining = [...characterNames]
      .map((value) => value.trim())
      .filter((value) => value !== "");

    for (let slotIndex = 0; slotIndex < MAX_CATEGORY_SLOTS; slotIndex += 1) {
      const listId = categorySlotListIds[slotIndex] ?? "";
      if (listId.trim() === "") {
        continue;
      }

      const itemList = resolveItemList(listId);
      if (!itemList) {
        continue;
      }

      const allowDuplicates = Boolean(categorySlotAllowDuplicates[slotIndex]);
      const selections: string[] = [];
      for (let index = 0; index < remaining.length; index += 1) {
        const itemName = remaining[index];
        if (!itemList.items.includes(itemName)) {
          continue;
        }
        if (!allowDuplicates && selections.includes(itemName)) {
          continue;
        }

        selections.push(itemName);
        remaining.splice(index, 1);
        index -= 1;
      }
      categorySelections[slotIndex] = selections;
    }

    return categorySelections;
  }

  useEffect(() => {
    if (!selectedEvent) {
      setMetaDrafts({});
      return;
    }

    setMetaDrafts((current) => {
      const next = { ...current };
      for (const entrant of selectedEventEntrants) {
        const key = getMetaDraftKey(selectedEvent.eventId, entrant.entrantId);
        const existingMeta = findEntrantMeta(selectedEvent.eventId, entrant.entrantId);
        if (!current[key] || !dirtyMetaDraftKeysRef.current.has(key)) {
          next[key] = {
            aliasName: existingMeta?.aliasName ?? "",
            playSide: existingMeta?.playSide ?? "",
            categorySelections: buildInitialCategorySelections(existingMeta?.characterNames ?? []),
          };
        }
      }
      return next;
    });
  }, [
    categorySlotAllowDuplicates,
    categorySlotListIds,
    itemLists,
    selectedEvent,
    selectedEventEntrants,
    selectedEventItemListSnapshots,
    selectedEventMeta,
  ]);

  function getMetaDraft(eventId: string, entrantId: string): PlayerMetaDraft {
    const key = getMetaDraftKey(eventId, entrantId);
    const existingMeta = findEntrantMeta(eventId, entrantId);
    return metaDrafts[key] ?? {
      aliasName: existingMeta?.aliasName ?? "",
      playSide: existingMeta?.playSide ?? "",
      categorySelections: buildInitialCategorySelections(existingMeta?.characterNames ?? []),
    };
  }

  function setMetaDraft(eventId: string, entrantId: string, patch: Partial<PlayerMetaDraft>) {
    const key = getMetaDraftKey(eventId, entrantId);
    const existingMeta = findEntrantMeta(eventId, entrantId);
    dirtyMetaDraftKeysRef.current.add(key);
    setMetaDrafts((current) => {
      const baseDraft = current[key] ?? {
        aliasName: existingMeta?.aliasName ?? "",
        playSide: existingMeta?.playSide ?? "",
        categorySelections: emptyCategorySelections(),
      };
      const nextSelections = patch.categorySelections
        ? patch.categorySelections.slice(0, MAX_CATEGORY_SLOTS).map((items) =>
          Array.isArray(items)
            ? items.map((value) => value.trim()).filter((value) => value !== "")
            : [],
        )
        : baseDraft.categorySelections;
      while (nextSelections.length < MAX_CATEGORY_SLOTS) {
        nextSelections.push([]);
      }

      return {
        ...current,
        [key]: {
          ...baseDraft,
          ...patch,
          categorySelections: nextSelections,
        },
      };
    });
  }

  function getDraftCategorySelections(draft: PlayerMetaDraft, slotIndex: number): string[] {
    return (draft.categorySelections[slotIndex] ?? [])
      .map((value) => value.trim())
      .filter((value) => value !== "");
  }

  function setDraftCategorySelections(
    eventId: string,
    entrantId: string,
    slotIndex: number,
    nextSelections: string[],
  ) {
    const draft = getMetaDraft(eventId, entrantId);
    const categorySelections = draft.categorySelections
      .slice(0, MAX_CATEGORY_SLOTS)
      .map((items) => [...items]);
    while (categorySelections.length < MAX_CATEGORY_SLOTS) {
      categorySelections.push([]);
    }
    categorySelections[slotIndex] = nextSelections
      .map((value) => value.trim())
      .filter((value) => value !== "");
    setMetaDraft(eventId, entrantId, { categorySelections });
  }

  function addDraftCategorySelection(
    eventId: string,
    entrantId: string,
    slotIndex: number,
    list: ItemListConfig,
    allowDuplicates: boolean,
    maxCount: number,
    itemName: string,
  ) {
    const normalizedItem = itemName.trim();
    if (normalizedItem === "" || !list.items.includes(normalizedItem)) {
      return;
    }

    const currentSelections = getDraftCategorySelections(getMetaDraft(eventId, entrantId), slotIndex);
    if ((!allowDuplicates && currentSelections.includes(normalizedItem)) || currentSelections.length >= maxCount) {
      return;
    }
    setDraftCategorySelections(eventId, entrantId, slotIndex, [...currentSelections, normalizedItem]);
  }

  function removeDraftCategorySelection(
    eventId: string,
    entrantId: string,
    slotIndex: number,
    removeIndex: number,
  ) {
    const currentSelections = getDraftCategorySelections(getMetaDraft(eventId, entrantId), slotIndex);
    if (removeIndex < 0 || removeIndex >= currentSelections.length) {
      return;
    }
    setDraftCategorySelections(
      eventId,
      entrantId,
      slotIndex,
      currentSelections.filter((_, index) => index !== removeIndex),
    );
  }

  function setSelectedEntrantAliasName(aliasName: string) {
    if (!selectedEvent || !selectedEntrant) {
      return;
    }
    setMetaDraft(selectedEvent.eventId, selectedEntrant.entrantId, { aliasName });
  }

  function buildValidatedSelections(
    draft: PlayerMetaDraft,
    slots: EventSettingCategorySlot[],
  ): { normalizedBySlot: string[][]; flattened: string[]; errors: string[] } {
    const normalizedBySlot = emptyCategorySelections();
    const flattened: string[] = [];
    const errors: string[] = [];

    for (const slot of slots) {
      const allowedItems = new Set(slot.list.items);
      let selections = getDraftCategorySelections(draft, slot.slotIndex)
        .filter((value) => allowedItems.has(value));
      if (!slot.allowDuplicates) {
        selections = [...new Set(selections)];
      }
      if (selections.length < slot.minCount) {
        errors.push(`${slot.list.categoryName}: 最低 ${slot.minCount} 件必要です。`);
      }
      if (selections.length > slot.maxCount) {
        errors.push(`${slot.list.categoryName}: 最大 ${slot.maxCount} 件までです。`);
      }
      normalizedBySlot[slot.slotIndex] = selections;
      flattened.push(...selections);
    }

    const totalMin = clampNonNegativeInteger(totalItemMinCount, 0);
    const totalMax = Math.max(clampNonNegativeInteger(totalItemMaxCount, 0), totalMin);
    if (flattened.length < totalMin) {
      errors.push(`全体の選択数が不足しています (最低 ${totalMin} 件)。`);
    }
    if (flattened.length > totalMax) {
      errors.push(`全体の選択数が超過しています (最大 ${totalMax} 件)。`);
    }
    return { normalizedBySlot, flattened, errors };
  }

  function clearDirtyDraft(eventId: string, entrantId: string) {
    dirtyMetaDraftKeysRef.current.delete(getMetaDraftKey(eventId, entrantId));
  }

  async function savePlayerMeta(
    eventSnapshot: EventSnapshot,
    entrantId: string,
    entrantName: string,
    options?: SavePlayerMetaOptions,
  ) {
    const silent = options?.silent ?? false;
    const manageBusy = options?.manageBusy ?? true;
    const normalizedSlug = toApiSlug(slug);
    const draft = getMetaDraft(eventSnapshot.eventId, entrantId);
    const validated = buildValidatedSelections(draft, configuredCategorySlots);

    if (validated.errors.length > 0) {
      setError(validated.errors.join(" "));
      return;
    }

    setMetaDraft(eventSnapshot.eventId, entrantId, {
      categorySelections: validated.normalizedBySlot,
    });

    if (manageBusy) {
      setBusy(true);
    }
    setError("");
    if (!silent) {
      setMessage("");
    }

    try {
      await saveLocalPlayerMeta({
        slug: normalizedSlug,
        eventId: eventSnapshot.eventId,
        eventName: eventSnapshot.name,
        entrantId,
        entrantName,
        aliasName: draft.aliasName,
        playSide: null,
        characterNames: validated.flattened,
        notes: null,
      });

      clearDirtyDraft(eventSnapshot.eventId, entrantId);
      if (!silent) {
        setMessage("ローカルメタを保存しました。");
      }
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      if (manageBusy) {
        setBusy(false);
      }
    }
  }

  function addSelectedEntrantDraftSelection(slot: EventSettingCategorySlot, itemName: string) {
    if (!selectedEvent || !selectedEntrant) {
      return;
    }
    addDraftCategorySelection(
      selectedEvent.eventId,
      selectedEntrant.entrantId,
      slot.slotIndex,
      slot.list,
      slot.allowDuplicates,
      slot.maxCount,
      itemName,
    );
  }

  function removeSelectedEntrantDraftSelection(slotIndex: number, selectionIndex: number) {
    if (!selectedEvent || !selectedEntrant) {
      return;
    }
    removeDraftCategorySelection(
      selectedEvent.eventId,
      selectedEntrant.entrantId,
      slotIndex,
      selectionIndex,
    );
  }

  function saveSelectedEntrantMeta() {
    if (selectedEvent && selectedEntrant) {
      void savePlayerMeta(selectedEvent, selectedEntrant.entrantId, selectedEntrant.entrantName);
    }
  }

  const selectedEntrantMetaDraft = selectedEvent && selectedEntrant
    ? getMetaDraft(selectedEvent.eventId, selectedEntrant.entrantId)
    : null;
  const selectedEntrantDraftSelectionsBySlot = selectedEntrantMetaDraft
    ? configuredCategorySlots.map((slot) =>
      getDraftCategorySelections(selectedEntrantMetaDraft, slot.slotIndex),
    )
    : [];
  const selectedEntrantAliasName = selectedEntrantMetaDraft?.aliasName ?? "";
  const selectedEntrantValidationErrors = selectedEntrantMetaDraft
    ? buildValidatedSelections(selectedEntrantMetaDraft, configuredCategorySlots).errors
    : [];

  return {
    setMetaDraft,
    selectedEntrantDraftSelectionsBySlot,
    selectedEntrantAliasName,
    setSelectedEntrantAliasName,
    selectedEntrantValidationErrors,
    addDraftCategorySelection,
    removeDraftCategorySelection,
    clearDirtyDraft,
    savePlayerMeta,
    addSelectedEntrantDraftSelection,
    removeSelectedEntrantDraftSelection,
    saveSelectedEntrantMeta,
  };
}