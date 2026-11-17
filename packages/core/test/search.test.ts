import { describe, expect, test } from "bun:test";
import { searchTerms, stemTerm, toFtsQuery } from "../src/db/search.ts";

describe("stemTerm", () => {
  test("strips one Czech inflectional ending", () => {
    expect(stemTerm("drakovi")).toBe("drak");
    expect(stemTerm("Sherlockem")).toBe("sherlock");
    expect(stemTerm("Holmese")).toBe("holmes");
    expect(stemTerm("války")).toBe("valk");
  });
  test("never cuts below four chars", () => {
    expect(stemTerm("děti")).toBe("deti");
    expect(stemTerm("noci")).toBe("noci");
  });
});

describe("searchTerms / toFtsQuery", () => {
  test("drops stopwords, folds and stems", () => {
    expect(searchTerms("Válka s mloky")).toEqual(["valk", "mlok"]);
    expect(toFtsQuery("pohádka o drakovi")).toBe('"pohadk"* AND "drak"*');
  });
  test("keeps a stopword-only query and strips FTS syntax", () => {
    expect(searchTerms("o")).toEqual(["o"]);
    expect(toFtsQuery('"sherlock" (holmes)*')).toBe('"sherlock"* AND "holmes"*');
    expect(toFtsQuery("  ")).toBe("");
  });
});
