/**
 * CSV building with protection against spreadsheet formula injection: a cell that starts with = + - @
 * (or a tab/CR) is executed by Excel and Google Sheets, so a name like "=HYPERLINK(...)" typed by an
 * employee would run when HR opens the export. Such text is prefixed with an apostrophe.
 * Plain numbers, including negatives, are left untouched.
 */

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

const csvCell = (value) => {
  let text = value == null ? "" : String(value);
  if (typeof value !== "number" && FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (headers, rows) => [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

module.exports = { csvCell, toCsv };
