// Minimal RFC 4180 CSV parser (no dependency): comma separator, double-quote quoting with "" escapes,
// CRLF or LF line ends, optional UTF-8 BOM. Returns rows of raw strings; no type coercion.
// Malformed quoting is an error, never silently repaired.

export type CsvParse = { status: "ok"; header: string[]; rows: string[][] } | { status: "error"; detail: string };

export function parseCsv(text: string, limits = { maxBytes: 1_000_000, maxRows: 5000 }): CsvParse {
  if (new TextEncoder().encode(text).length > limits.maxBytes) return { status: "error", detail: `file larger than ${limits.maxBytes} bytes` };
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let i = 0;
  let quoted = false;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        if (i < src.length && src[i] !== "," && src[i] !== "\n" && src[i] !== "\r") return { status: "error", detail: `line ${line}: text after a closing quote` };
        continue;
      }
      if (c === "\n") line++;
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (field !== "") return { status: "error", detail: `line ${line}: quote inside an unquoted field` };
      quoted = true;
      i++;
    } else if (c === ",") {
      record.push(field);
      field = "";
      i++;
    } else if (c === "\r" || c === "\n") {
      record.push(field);
      field = "";
      if (!(record.length === 1 && record[0] === "")) records.push(record);
      record = [];
      if (c === "\r" && src[i + 1] === "\n") i++;
      i++;
      line++;
      if (records.length > limits.maxRows + 1) return { status: "error", detail: `more than ${limits.maxRows} rows` };
    } else {
      field += c;
      i++;
    }
  }
  if (quoted) return { status: "error", detail: "unterminated quoted field at end of file" };
  record.push(field);
  if (!(record.length === 1 && record[0] === "")) records.push(record);
  if (!records.length) return { status: "error", detail: "empty file" };
  if (records.length > limits.maxRows + 1) return { status: "error", detail: `more than ${limits.maxRows} rows` };
  const [header, ...rows] = records;
  return { status: "ok", header: header.map((h) => h.trim()), rows };
}
