/**
 * Reads result messages from analyzers. Two standards cover almost every
 * machine: ASTM E1394 (records like H|, P|, O|, R|, L|) and HL7 v2 (segments
 * like MSH|, OBR|, OBX|). The interface program strips the transport framing
 * (ENQ/STX/ETX, MLLP) and sends the text; this turns it into sample IDs and values.
 *
 * Makers put the sample ID and test code in slightly different places, so
 * both come back as candidates (in order of likelihood) and the caller keeps
 * the first that matches something in LabOS.
 */

export interface ParsedValue {
  /** Possible test codes, most likely first, e.g. ["WBC"] or ["2345-7", "GLU"]. */
  codes: string[];
  value: string;
  unit: string | null;
  /** The analyzer's own abnormal flag (H, L, A...), kept for the log only. */
  flag: string | null;
}

export interface ParsedSample {
  /** Possible sample IDs (normally the tube's barcode), most likely first. */
  ids: string[];
  values: ParsedValue[];
}

export interface ParsedMessage {
  protocol: "ASTM" | "HL7";
  samples: ParsedSample[];
  /** The HL7 message control ID, for the acknowledgement. */
  controlId?: string | null;
}

const clean = (s: string | undefined | null) => (s ?? "").trim();
const nonEmpty = (xs: (string | undefined)[]) => [...new Set(xs.map(clean).filter(Boolean))];

/** Removes ASTM low-level framing if the program passed it through: STX, frame number, ETB/ETX + checksum. */
function stripAstmFrames(text: string): string {
  if (!text.includes("\x02")) return text;
  let out = "";
  const re = /\x02\d?([\s\S]*?)[\x17\x03][0-9A-Fa-f]{0,2}\r?\n?/g;
  for (const m of text.matchAll(re)) out += m[1];
  return out || text;
}

export function detectProtocol(text: string): "ASTM" | "HL7" | null {
  const t = text.replace(/^[\x00-\x1f\s]+/, "");
  if (t.startsWith("MSH")) return "HL7";
  if (/^\d?H[|\\^&]/.test(t)) return "ASTM";
  if (/(^|[\r\n])MSH\|/.test(text)) return "HL7";
  if (/(^|[\r\n\x02]\d?)H\|/.test(text)) return "ASTM";
  return null;
}

export function parseMessage(text: string, hint?: "ASTM" | "HL7"): ParsedMessage {
  const protocol = detectProtocol(text) ?? hint;
  if (protocol === "HL7") return parseHl7(text);
  if (protocol === "ASTM") return parseAstm(text);
  throw new Error("This doesn't look like an ASTM or HL7 message");
}

// ---------------------------------------------------------------------------
// ASTM E1394
// ---------------------------------------------------------------------------

export function parseAstm(input: string): ParsedMessage {
  const text = stripAstmFrames(input).replace(/\x0d\x0a/g, "\r").replace(/\n/g, "\r");
  // Records may carry the frame number in front ("1H|..."); drop it.
  const records = text
    .split("\r")
    .map((r) => r.replace(/^[\x00-\x1f]*\d?(?=[A-Z][|])/, "").trim())
    .filter(Boolean);
  const header = records.find((r) => r.startsWith("H"));
  if (!header) throw new Error("ASTM message without a header (H) record");
  // H|\^&| : field, repeat, component, escape delimiters.
  const field = header[1] ?? "|";
  const repeat = header[2] ?? "\\";
  const component = header[3] ?? "^";

  const samples: ParsedSample[] = [];
  let current: ParsedSample | null = null;
  let patientIds: string[] = [];
  for (const rec of records) {
    const f = rec.split(field);
    const type = f[0]!.slice(-1);
    if (type === "P") {
      // Some analyzers put the sample ID in the patient record (P-3 or P-4).
      patientIds = nonEmpty([f[2], f[3], f[4]].flatMap((x) => (x ?? "").split(component)));
    } else if (type === "O") {
      // O-3 specimen ID (sent by the LIS), O-4 instrument specimen ID; either may carry components (ID^rack^position).
      const firstPart = (x: string | undefined) => (x ?? "").split(repeat)[0]!.split(component);
      const o3 = firstPart(f[2]);
      const o4 = firstPart(f[3]);
      current = { ids: nonEmpty([o3[0], o4[0], ...o3.slice(1), ...o4.slice(1), ...patientIds]), values: [] };
      samples.push(current);
    } else if (type === "R") {
      if (!current) {
        current = { ids: patientIds, values: [] };
        samples.push(current);
      }
      // R-3 universal test ID: ^^^CODE or ^^^^CODE^dilution or CODE^name.
      const id = (f[2] ?? "").split(component);
      const codes = nonEmpty([...id.slice(3), ...id.slice(0, 3)]);
      // R-4 value; some send "value^..." components.
      const value = clean((f[3] ?? "").split(component)[0]);
      if (!codes.length || !value) continue;
      current.values.push({ codes, value, unit: clean(f[4]) || null, flag: clean(f[6]) || null });
    } else if (type === "L") {
      current = null;
      patientIds = [];
    }
  }
  return { protocol: "ASTM", samples: samples.filter((s) => s.values.length || s.ids.length) };
}

// ---------------------------------------------------------------------------
// HL7 v2 (ORU^R01 and similar)
// ---------------------------------------------------------------------------

export function parseHl7(input: string): ParsedMessage {
  const text = input.replace(/[\x0b\x1c]/g, "").replace(/\r\n/g, "\r").replace(/\n/g, "\r");
  const segments = text.split("\r").map((s) => s.trim()).filter(Boolean);
  const msh = segments.find((s) => s.startsWith("MSH"));
  if (!msh) throw new Error("HL7 message without an MSH segment");
  const field = msh[3] ?? "|";
  const component = msh[4] ?? "^";
  const repeat = msh[5] ?? "~";
  const mshFields = msh.split(field);
  // MSH counts the separator itself as field 1, so MSH-10 sits at index 9.
  const controlId = clean(mshFields[9]) || null;

  const samples: ParsedSample[] = [];
  let current: ParsedSample | null = null;
  let pidIds: string[] = [];
  const comps = (x: string | undefined) => (x ?? "").split(repeat)[0]!.split(component);
  for (const seg of segments) {
    const f = seg.split(field);
    const type = f[0];
    if (type === "PID") {
      pidIds = nonEmpty([comps(f[3])[0], comps(f[2])[0]]);
    } else if (type === "OBR") {
      // OBR-3 filler order number (often the barcode), OBR-2 placer order number.
      current = { ids: nonEmpty([comps(f[3])[0], comps(f[2])[0], ...pidIds]), values: [] };
      samples.push(current);
    } else if (type === "SPM" && current) {
      // SPM-2 specimen ID, when sent, is the best guess for the barcode.
      current.ids = nonEmpty([comps(f[2])[0], ...current.ids]);
    } else if (type === "ORC" && !current) {
      pidIds = nonEmpty([comps(f[3])[0], comps(f[2])[0], ...pidIds]);
    } else if (type === "OBX") {
      if (!current) {
        current = { ids: pidIds, values: [] };
        samples.push(current);
      }
      // OBX-3 identifier: code^text^system; some put a number first and the name second.
      const id = comps(f[3]);
      const codes = nonEmpty([id[0], id[1], id[3], id[4]]);
      const value = clean(comps(f[5])[0]);
      if (!codes.length || !value) continue;
      current.values.push({ codes, value, unit: clean(comps(f[6])[0]) || null, flag: clean(f[8]) || null });
    }
  }
  return { protocol: "HL7", samples: samples.filter((s) => s.values.length || s.ids.length), controlId };
}

/** The reply an HL7 analyzer waits for after each message. */
export function hl7Ack(controlId: string | null | undefined, ok = true): string {
  const now = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return [`MSH|^~\\&|LABOS|LAB|||${now}||ACK|${now}|P|2.3.1`, `MSA|${ok ? "AA" : "AE"}|${controlId ?? ""}`].join("\r") + "\r";
}
