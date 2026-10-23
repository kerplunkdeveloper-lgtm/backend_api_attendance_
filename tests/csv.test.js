const test = require("node:test");
const assert = require("node:assert/strict");
const { csvCell, toCsv } = require("../src/utils/csv");

test("neutralises spreadsheet formulas in text cells", () => {
  for (const evil of ['=HYPERLINK("http://x","y")', "+1+1", "-2+3", "@SUM(A1)", "\tcmd"]) {
    assert.ok(csvCell(evil).replace(/^"/, "").startsWith("'"), evil);
  }
});

test("leaves ordinary text and real numbers alone, negatives included", () => {
  assert.equal(csvCell("Priya Nair"), "Priya Nair");
  assert.equal(csvCell(-1250.5), "-1250.5");
  assert.equal(csvCell("-1250.5"), "-1250.5");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("quotes commas, quotes and newlines", () => {
  assert.equal(csvCell("Nair, Priya"), '"Nair, Priya"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("a\nb"), '"a\nb"');
});

test("builds header and rows", () => {
  assert.equal(toCsv(["Name", "Pay"], [["A", 1], ["=B", 2]]), "Name,Pay\nA,1\n'=B,2");
});
