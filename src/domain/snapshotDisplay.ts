import type { TournamentEventPreviewItem } from "../components/CreateSnapshot";
import type { LocalSnapshotEventListItem } from "./tournamentWorkspaceRepository";

export function localSnapshotItemKey(item: LocalSnapshotEventListItem): string {
  return `${item.slug}:${item.eventId}`;
}

export function localSnapshotAliasLabel(item: LocalSnapshotEventListItem): string {
  if (item.eventAlias && item.eventAlias.trim() !== "") {
    return item.eventAlias.trim();
  }
  if (item.eventName && item.eventName.trim() !== "") {
    return item.eventName.trim();
  }
  return item.eventId;
}

function normalizeSnapshotSlug(rawSlug: string): string {
  const trimmed = rawSlug.trim();
  const withoutPrefix = trimmed.startsWith("tournament/")
    ? trimmed.slice("tournament/".length)
    : trimmed;
  return withoutPrefix.replace(/^\/+|\/+$/g, "");
}

export function sameSnapshotEventKey(
  leftSlug: string,
  leftEventId: string,
  rightSlug: string,
  rightEventId: string,
): boolean {
  return normalizeSnapshotSlug(leftSlug) === normalizeSnapshotSlug(rightSlug)
    && leftEventId.trim() === rightEventId.trim();
}

export function findSnapshotEventByIdentity(
  items: LocalSnapshotEventListItem[],
  slug: string,
  eventId: string,
): LocalSnapshotEventListItem | null {
  return items.find((item) => sameSnapshotEventKey(slug, eventId, item.slug, item.eventId)) ?? null;
}

export function resolveSelectedSnapshotName(
  items: LocalSnapshotEventListItem[],
  options: {
    eventAlias?: string | null;
    eventName?: string | null;
    slug: string;
    eventId: string;
    fallbackName: string;
  },
): string {
  const alias = options.eventAlias?.trim();
  if (alias) {
    return alias;
  }
  if (options.eventName) {
    return options.eventName;
  }

  if (options.slug !== "" && options.eventId !== "") {
    const matched = findSnapshotEventByIdentity(items, options.slug, options.eventId);
    const matchedAlias = matched?.eventAlias?.trim();
    if (matchedAlias) {
      return matchedAlias;
    }
    if (matched?.eventName) {
      return matched.eventName;
    }
  }

  return options.fallbackName;
}

export function filterLocalSnapshotEvents(
  items: LocalSnapshotEventListItem[],
  searchInput: string,
): LocalSnapshotEventListItem[] {
  const normalizedQuery = searchInput.trim().toLocaleLowerCase();
  if (normalizedQuery === "") {
    return items;
  }

  return items.filter((item) =>
    localSnapshotAliasLabel(item).toLocaleLowerCase().includes(normalizedQuery)
    || item.tournamentName.toLocaleLowerCase().includes(normalizedQuery)
    || item.eventName.toLocaleLowerCase().includes(normalizedQuery)
    || item.slug.toLocaleLowerCase().includes(normalizedQuery)
  );
}

export function findSelectedLocalSnapshotEvent(
  items: LocalSnapshotEventListItem[],
  selectedKey: string,
): LocalSnapshotEventListItem | null {
  if (selectedKey === "") {
    return null;
  }
  return items.find((item) => localSnapshotItemKey(item) === selectedKey) ?? null;
}

export function resolveCreatePreviewSelection(
  events: TournamentEventPreviewItem[],
  preferredEventId: string,
): TournamentEventPreviewItem | null {
  if (preferredEventId !== "") {
    const matched = events.find((event) => event.eventId === preferredEventId);
    if (matched) {
      return matched;
    }
  }
  return events[0] ?? null;
}

export function findCreatePreviewEvent(
  events: TournamentEventPreviewItem[],
  eventId: string,
): TournamentEventPreviewItem | null {
  return events.find((event) => event.eventId === eventId) ?? null;
}

export function filterCreatePreviewEvents(
  events: TournamentEventPreviewItem[],
  searchInput: string,
): TournamentEventPreviewItem[] {
  const normalizedQuery = searchInput.trim().toLocaleLowerCase();
  if (normalizedQuery === "") {
    return events;
  }

  return events.filter((event) =>
    event.eventName.toLocaleLowerCase().includes(normalizedQuery)
    || event.eventId.toLocaleLowerCase().includes(normalizedQuery)
    || (event.eventSlug ?? "").toLocaleLowerCase().includes(normalizedQuery)
  );
}
