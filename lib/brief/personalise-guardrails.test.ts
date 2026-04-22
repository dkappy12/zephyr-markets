import { describe, expect, it } from "vitest";
import {
  containsDisallowedVoice,
  positionReferencedInText,
  validatePersonalisedParagraph,
} from "./personalise-guardrails";

describe("personalise-guardrails", () => {
  it("positionReferencedInText matches full label", () => {
    expect(
      positionReferencedInText(
        "The long NBP Winter 2026 leg benefits from cold.",
        "NBP Winter 2026",
      ),
    ).toBe(true);
  });

  it("containsDisallowedVoice allows US without false positive on pronoun us", () => {
    expect(containsDisallowedVoice("US Henry Hub prints at 3.50.")).toBe(false);
  });

  it("containsDisallowedVoice rejects first person", () => {
    expect(containsDisallowedVoice("We see risk in the short leg.")).toBe(true);
  });

  it("validatePersonalisedParagraph rejects filler", () => {
    expect(
      validatePersonalisedParagraph(
        "It is worth noting that The long Foo Bar at £90 remains stable.",
        ["Foo Bar"],
      ),
    ).toBe(false);
  });

  it("validatePersonalisedParagraph passes third-person copy with labels", () => {
    expect(
      validatePersonalisedParagraph(
        "The long Foo Bar faces £12/MWh drag; The short Baz leg gains.",
        ["Foo Bar", "Baz"],
      ),
    ).toBe(true);
  });
});
