import { describe, expect, it } from "vitest";
import { toApiSlug, toEventApiSlug, toEventSlugInput, toSlugInput } from "./slugUtils";

describe("slug normalization", () => {
  it("normalizes tournament input with or without its API prefix", () => {
    expect(toSlugInput(" /tournament/example/ ")).toBe("tournament/example");
    expect(toSlugInput("  example  ")).toBe("example");
    expect(toApiSlug("tournament/example")).toBe("tournament/example");
    expect(toApiSlug(" /example/ ")).toBe("tournament/example");
    expect(toApiSlug(" ")).toBe("");
  });

  it("builds event API slugs from tournament and event input", () => {
    expect(toEventApiSlug("example", "event/singles")).toBe("tournament/example/event/singles");
    expect(toEventApiSlug("example", "tournament/other/event/doubles")).toBe("tournament/other/event/doubles");
    expect(toEventApiSlug("", "singles")).toBe("");
    expect(toEventApiSlug("example", " / ")).toBe("");
  });

  it("extracts an event slug from a selected event path", () => {
    expect(toEventSlugInput("tournament/example/event/singles")).toBe("singles");
    expect(toEventSlugInput("event/singles")).toBe("singles");
    expect(toEventSlugInput(" ")).toBe("");
  });
});
