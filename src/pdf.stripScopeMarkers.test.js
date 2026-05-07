import { stripScopeMarkdownMarkers } from "./pdf";

jest.mock("jspdf", () => jest.fn());
jest.mock("jspdf-autotable", () => jest.fn());

describe("stripScopeMarkdownMarkers", () => {
  test("strips heading markers at the start of a line", () => {
    expect(stripScopeMarkdownMarkers("## Heading")).toBe("Heading");
  });

  test("strips heading markers across multiple lines", () => {
    expect(stripScopeMarkdownMarkers("## Heading\nBody line")).toBe("Heading\nBody line");
  });

  test("strips balanced bold markers", () => {
    expect(stripScopeMarkdownMarkers("**bold** word")).toBe("bold word");
  });

  test("strips balanced underscore italic markers", () => {
    expect(stripScopeMarkdownMarkers("_italic_ word")).toBe("italic word");
  });

  test("keeps bullet lines unchanged", () => {
    expect(stripScopeMarkdownMarkers("- bullet")).toBe("- bullet");
  });

  test("keeps numbered lines unchanged", () => {
    expect(stripScopeMarkdownMarkers("1. step")).toBe("1. step");
  });

  test("keeps urls unchanged", () => {
    expect(stripScopeMarkdownMarkers("https://example.com")).toBe("https://example.com");
  });

  test("keeps plain text unchanged", () => {
    expect(stripScopeMarkdownMarkers("plain text")).toBe("plain text");
  });

  test("returns empty string for empty input", () => {
    expect(stripScopeMarkdownMarkers("")).toBe("");
  });

  test("leaves malformed markers unchanged", () => {
    expect(stripScopeMarkdownMarkers("**unclosed")).toBe("**unclosed");
  });

  test("returns empty string for nullish input", () => {
    expect(stripScopeMarkdownMarkers(null)).toBe("");
    expect(stripScopeMarkdownMarkers(undefined)).toBe("");
  });

  test("does not strip underscores inside normal words or urls", () => {
    expect(stripScopeMarkdownMarkers("scope_note")).toBe("scope_note");
    expect(stripScopeMarkdownMarkers("https://example.com/a_b")).toBe("https://example.com/a_b");
  });
});
