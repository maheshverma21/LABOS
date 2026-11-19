import { createContext, useContext } from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { CULTURE_OUTCOME_LABEL, DEFAULT_REPORT_HEADER, REPORT_HEADER_FIELDS, DEFAULT_TEMPLATE, FLAG_SHORT, isCritical, type ReportDoctorItem, type ReportHeaderSettings, type ReportTemplateValues, type ResultFlag } from "@lms/shared";
import { pdfFont, type PdfFont } from "./report-fonts";
import type { ReportData, ReportTest, Signatory } from "./report-data";

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const ABNORMAL = "#b91c1c";

/** Low and high values print in the template's colours. */
type FlagColours = { low: string; high: string };
/** PDF points per millimetre. */
const MM = 72 / 25.4;
/** Room for the footer strip (QR code, disclaimer, page number). */
const FOOTER_STRIP = 44;
const PAGE_W = 595.28;

const makeStyles = (F: PdfFont) => StyleSheet.create({
  page: { fontSize: 9, fontFamily: F.regular, color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1.5, paddingBottom: 8, gap: 12 },
  labName: { fontSize: 16, fontFamily: F.bold },
  logo: { maxHeight: 52, maxWidth: 120, objectFit: "contain" },
  muted: { color: MUTED },
  small: { fontSize: 8 },
  patient: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: RULE, paddingVertical: 8, gap: 16 },
  col: { flex: 1, gap: 2 },
  kv: { flexDirection: "row" },
  k: { width: 84, color: MUTED },
  v: { flex: 1, fontFamily: F.bold },
  vPlain: { flex: 1 },
  banner: { marginTop: 8, padding: 5, borderWidth: 0.75, borderColor: ABNORMAL, color: ABNORMAL, textAlign: "center", fontFamily: F.bold },
  dept: { marginTop: 14, fontSize: 10.5, fontFamily: F.bold, textAlign: "center", textTransform: "uppercase", letterSpacing: 1 },
  thead: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: INK, paddingVertical: 4, marginTop: 6, fontFamily: F.bold },
  row: { flexDirection: "row", paddingVertical: 2.5 },
  cName: { flex: 4 },
  cValue: { flex: 2 },
  cUnit: { flex: 1.6 },
  cRange: { flex: 2.4 },
  testName: { marginTop: 8, fontFamily: F.bold, fontSize: 9.5 },
  indent: { paddingLeft: 8 },
  method: { color: MUTED, fontSize: 7.5, marginTop: 0.5 },
  interpTitle: { marginTop: 6, fontFamily: F.bold, fontSize: 8.5 },
  note: { marginTop: 3, color: MUTED, fontSize: 8, lineHeight: 1.35 },
  end: { marginTop: 16, textAlign: "center", color: MUTED, fontSize: 8 },
  signs: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 28, marginTop: 20 },
  sign: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  signText: { alignItems: "center", minWidth: 130 },
  signature: { height: 38, maxWidth: 140, objectFit: "contain", marginBottom: 2 },
  stamp: { height: 58, width: 58, objectFit: "contain" },
  footer: { position: "absolute", flexDirection: "row", alignItems: "flex-end", borderTopWidth: 0.75, borderTopColor: RULE, paddingTop: 6, gap: 10 },
  qr: { width: 34, height: 34 },
});

type Styles = ReturnType<typeof makeStyles>;
const styleCache = new Map<string, { F: PdfFont; s: Styles }>();
/** Fonts and styles for the report being drawn, shared by every part of it. */
const FontContext = createContext<{ F: PdfFont; s: Styles }>({ F: pdfFont("helvetica"), s: makeStyles(pdfFont("helvetica")) });
const useLook = () => useContext(FontContext);
const looksFor = (id: string) => {
  let v = styleCache.get(id);
  if (!v) {
    const F = pdfFont(id);
    v = { F, s: makeStyles(F) };
    styleCache.set(id, v);
  }
  return v;
};

/** An image ready for the PDF: raw bytes plus their format. */
export type PdfImage = { data: Buffer; format: "png" | "jpg" };

/** A report doctor ready to draw. */
export type LookDoctor = Omit<ReportDoctorItem, "signatureId"> & { signatureId: string | null; signature: PdfImage | null };

/** How the report looks: the template and the images it uses. */
export interface ReportLook {
  template: ReportTemplateValues;
  logo: PdfImage | null;
  header: PdfImage | null;
  footer: PdfImage | null;
  /** A full A4 page image drawn behind every page. */
  background?: PdfImage | null;
  /** Report doctors to sign this print (fixed ones, plus any picked). */
  doctors?: LookDoctor[];
  /** The lab has set up report doctors, so approvers' signatures are not used. */
  hasDoctors?: boolean;
  /** Which patient and order details the header prints, in order (Report settings). */
  headerFields?: ReportHeaderSettings;
  /** Signature and stamp images by asset id. */
  images: Map<string, PdfImage>;
}

export const plainLook = (): ReportLook => ({ template: DEFAULT_TEMPLATE, logo: null, header: null, footer: null, images: new Map() });

function KV({ k, v, bold = false }: { k: string; v: string | null; bold?: boolean }) {
  const { F, s } = useLook();
  return (
    <View style={s.kv}>
      <Text style={s.k}>{k}</Text>
      <Text style={bold ? s.v : s.vPlain}>{v || "-"}</Text>
    </View>
  );
}

function ResultRow({ row, indent, colours }: { row: ReportTest["rows"][number]; indent: boolean; colours: FlagColours }) {
  const { F, s } = useLook();
  const abnormal = row.flag != null && row.flag !== "NORMAL";
  const colour = row.flag === "LOW" || row.flag === "CRITICAL_LOW" ? colours.low : colours.high;
  const flag = (f: ResultFlag | null) => (f ? FLAG_SHORT[f] : "");
  return (
    <View style={s.row} wrap={false}>
      <View style={[s.cName, ...(indent ? [s.indent] : [])]}>
        <Text>{row.name}</Text>
        {row.method ? <Text style={s.method}>Method: {row.method}</Text> : null}
      </View>
      <Text style={[s.cValue, ...(abnormal ? [{ fontFamily: F.bold, color: colour }] : [])]}>
        {row.value}
        {abnormal ? `  ${flag(row.flag)}` : ""}
        {isCritical(row.flag) ? " (critical)" : ""}
      </Text>
      <Text style={s.cUnit}>{row.unit ?? ""}</Text>
      <Text style={s.cRange}>{row.range}</Text>
    </View>
  );
}

const SIR_COLOUR = { S: "#15803d", I: "#b45309", R: "#b91c1c", SDD: "#b45309" } as const;

/** Culture & sensitivity: no-growth wording, or each organism with its antibiotic table. */
function CultureBlock({ test, culture }: { test: ReportTest; culture: NonNullable<ReportTest["culture"]> }) {
  const { F, s } = useLook();
  const { result, config, sample } = culture;
  return (
    <View style={{ marginBottom: 2 }}>
      <View wrap={false} minPresenceAhead={40}>
        <Text style={s.testName}>
          {test.name}
          {test.amended ? "  (amended)" : ""}
        </Text>
        {sample ? <Text style={[s.muted, s.small]}>Specimen: {sample}</Text> : null}
      </View>
      {result.microscopy ? (
        <Text style={{ marginTop: 4 }}>
          <Text style={{ fontFamily: F.bold }}>Microscopy: </Text>
          {result.microscopy}
        </Text>
      ) : null}
      <Text style={{ marginTop: 5 }}>
        <Text style={{ fontFamily: F.bold }}>Culture: </Text>
        {result.outcome === "NO_GROWTH" ? (result.noGrowthText ?? config.noGrowthText) : CULTURE_OUTCOME_LABEL.GROWTH}
      </Text>
      {result.outcome === "GROWTH"
        ? result.organisms.map((o, i) => {
            const rows = o.sensitivities;
            return (
              <View key={i} style={{ marginTop: 6 }}>
                <View wrap={false} minPresenceAhead={50}>
                  <Text style={{ fontFamily: F.bold }}>
                    {result.organisms.length > 1 ? `Isolate ${i + 1}: ` : "Organism isolated: "}
                    {o.name}
                  </Text>
                  {o.colonyCount ? <Text style={s.small}>Colony count: {o.colonyCount}</Text> : null}
                </View>
                {rows.length > 0 ? (
                  <View style={{ marginTop: 4 }}>
                    <View style={[s.thead, { marginTop: 0 }]} wrap={false}>
                      <Text style={{ flex: 5 }}>Antibiotic</Text>
                      {config.showMeasure ? <Text style={{ flex: 2 }}>Zone (mm) / MIC</Text> : null}
                      <Text style={{ flex: 2.5 }}>Interpretation</Text>
                    </View>
                    {rows.map((r) => (
                      <View key={r.antibiotic} style={s.row} wrap={false}>
                        <Text style={{ flex: 5 }}>{r.antibiotic}</Text>
                        {config.showMeasure ? <Text style={{ flex: 2 }}>{r.measure ?? ""}</Text> : null}
                        <Text style={{ flex: 2.5, fontFamily: F.bold, color: SIR_COLOUR[r.result] }}>
                          {r.result === "S" ? "Sensitive" : r.result === "I" ? "Intermediate" : r.result === "R" ? "Resistant" : "Susceptible, dose dependent"}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={s.note}>Antibiotic sensitivity not reported for this isolate.</Text>
                )}
              </View>
            );
          })
        : null}
      {result.outcome === "GROWTH" && config.footnote && result.organisms.some((o) => o.sensitivities.length > 0) ? (
        <Text style={s.note}>{config.footnote}</Text>
      ) : null}
      {test.remarks ? <Text style={s.note}>Remarks: {test.remarks}</Text> : null}
      {test.notes ? <Text style={s.note}>{test.notes}</Text> : null}
    </View>
  );
}

function TestBlock({ test, colours }: { test: ReportTest; colours: FlagColours }) {
  const { F, s } = useLook();
  if (test.culture) return <CultureBlock test={test} culture={test.culture} />;
  // A one-value test prints as a single row; a profile gets a heading with its rows indented.
  const single = test.rows.length === 1;
  return (
    <View style={{ marginBottom: 2 }}>
      {single ? (
        <View wrap={false}>
          <ResultRow row={{ ...test.rows[0]!, name: test.name }} indent={false} colours={colours} />
        </View>
      ) : (
        <>
          <View wrap={false} minPresenceAhead={30}>
            <Text style={s.testName}>
              {test.name}
              {test.amended ? "  (amended)" : ""}
            </Text>
          </View>
          {test.rows.map((r, i) => (
            <ResultRow key={i} row={r} indent colours={colours} />
          ))}
        </>
      )}
      {single && test.amended ? <Text style={s.note}>Amended result.</Text> : null}
      {test.remarks ? <Text style={s.note}>Remarks: {test.remarks}</Text> : null}
      {test.notes ? <Text style={s.note}>{test.notes}</Text> : null}
      {test.interpretation ? (
        <View wrap={false}>
          <Text style={s.interpTitle}>Interpretation</Text>
          <Text style={[s.note, { marginTop: 1 }]}>{test.interpretation}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The letterhead drawn from the lab profile. */
function BuiltInHeader({ data, look }: { data: ReportData; look: ReportLook }) {
  const { F, s } = useLook();
  const { template } = look;
  const address = data.branch?.address ?? data.lab.address;
  const phone = data.branch?.phone ?? data.lab.phone;
  const contact = [phone && `Ph: ${phone}`, data.lab.email, data.lab.website].filter(Boolean).join("   ");
  return (
    <View style={[s.header, { borderBottomColor: template.accentColor }]}>
      {template.showLogo && look.logo ? <Image src={look.logo} style={s.logo} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.labName, { color: template.accentColor }]}>{data.lab.name}</Text>
        {data.lab.tagline ? <Text style={{ fontSize: 8.5 }}>{data.lab.tagline}</Text> : null}
        {address ? <Text style={s.muted}>{address}</Text> : null}
        {contact ? <Text style={s.muted}>{contact}</Text> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 2, maxWidth: 170 }}>
        <Text style={{ fontFamily: F.bold, fontSize: 11 }}>LABORATORY REPORT</Text>
        {data.lab.accreditation ? <Text style={[s.small, { textAlign: "right" }]}>{data.lab.accreditation}</Text> : null}
        {data.lab.gstin ? <Text style={[s.muted, s.small]}>GSTIN {data.lab.gstin}</Text> : null}
      </View>
    </View>
  );
}

const ALIGN = { LEFT: "flex-start", CENTER: "center", RIGHT: "flex-end" } as const;
const TEXT_ALIGN = { LEFT: "left", CENTER: "center", RIGHT: "right" } as const;
/** Rough height of one doctor's block, so pages leave room for signatures printed at the bottom. */
const doctorHeight = (d: LookDoctor) => {
  const degreeLines = d.degree ? d.degree.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 38)), 0) : 0;
  return (
    d.signatureSize + d.spacing + (d.hideName ? 0 : d.nameFontSize * 1.3) + (degreeLines ? d.nameDegreeSpacing + degreeLines * d.degreeFontSize * 1.3 : 0)
  );
};

const DOCTOR_BLOCK_W = 170;

function DoctorBlock({ d, showSignature }: { d: LookDoctor; showSignature: boolean }) {
  const { F, s } = useLook();
  return (
    <View style={{ alignItems: ALIGN[d.alignment], width: DOCTOR_BLOCK_W }} wrap={false}>
      {showSignature && d.signature ? <Image src={d.signature} style={{ height: d.signatureSize, maxWidth: 160, objectFit: "contain" }} /> : null}
      {!d.hideName ? (
        <Text style={{ fontFamily: F.bold, fontSize: d.nameFontSize, marginTop: d.spacing, textAlign: TEXT_ALIGN[d.alignment] }}>{d.name}</Text>
      ) : null}
      {d.degree ? (
        <Text style={{ fontSize: d.degreeFontSize, marginTop: d.hideName ? d.spacing : d.nameDegreeSpacing, textAlign: TEXT_ALIGN[d.alignment] }}>{d.degree}</Text>
      ) : null}
    </View>
  );
}

/** Report doctors placed anywhere across the page: each one's position is 0 (left edge) to 100 (right edge). */
function DoctorRow({ doctors, showSignature, width }: { doctors: LookDoctor[]; showSignature: boolean; width: number }) {
  const height = Math.max(...doctors.map(doctorHeight));
  return (
    <View style={{ position: "relative", height, width }}>
      {doctors.map((d) => (
        <View key={d.id} style={{ position: "absolute", bottom: 0, left: (Math.min(100, Math.max(0, d.position)) / 100) * Math.max(width - DOCTOR_BLOCK_W, 0) }}>
          <DoctorBlock d={d} showSignature={showSignature} />
        </View>
      ))}
    </View>
  );
}

function Signature({ person, look }: { person: Signatory; look: ReportLook }) {
  const { F, s } = useLook();
  const show = look.template.showSignatures;
  const signature = show && person.signatureId ? look.images.get(person.signatureId) : undefined;
  const stamp = show && person.stampId ? look.images.get(person.stampId) : undefined;
  return (
    <View style={s.sign} wrap={false}>
      {stamp ? <Image src={stamp} style={s.stamp} /> : null}
      <View style={s.signText}>
        {signature ? <Image src={signature} style={s.signature} /> : <Text style={[s.muted, s.small]}>Electronically approved by</Text>}
        <Text style={{ fontFamily: F.bold, marginTop: signature ? 0 : 3 }}>{person.name}</Text>
        {person.qualification ? <Text>{person.qualification}</Text> : null}
        {person.registrationNo ? <Text style={s.small}>Reg. No. {person.registrationNo}</Text> : null}
      </View>
    </View>
  );
}

function Report({ data, qr, verifyUrl, look, separate }: { data: ReportData; qr: string | null; verifyUrl: string | null; look: ReportLook; separate: boolean }) {
  const { F, s } = useLook();
  const { template } = look;
  const builtIn = template.style === "BUILT_IN";
  // Image and pre-printed letterheads reserve their height at the top and bottom of every page.
  // The built-in letterhead honours them too: the header starts below the blank space, and the footer sits above it.
  const headerH = template.headerHeightMm * MM;
  const footerH = template.footerHeightMm * MM;
  const stripBottom = footerH + 16;
  const left = template.leftMarginMm * MM;
  const right = template.rightMarginMm * MM;
  const showQr = template.showQr && qr;
  // "Separate tests": every test starts on a page of its own, under its department heading.
  const pages: { key: string; departments: ReportData["departments"] }[] =
    separate && data.departments.length > 0
      ? data.departments.flatMap((d) => d.tests.map((t) => ({ key: `${d.name}-${t.code}`, departments: [{ ...d, tests: [t] }] })))
      : [{ key: "all", departments: data.departments }];

  const configured = look.hasDoctors === true;
  const showSignature = template.showSignatures;
  return (
    <Document title={`Report ${data.order.orderNo} - ${data.patient.name}`} author={data.lab.name}>
      {pages.map(({ key, departments }) => {
      // Doctors for this part of the report: those with no department limit, or one the report has tests from.
      const names = departments.map((d) => d.name);
      const doctors = (look.doctors ?? []).filter((d) => d.departments.length === 0 || d.departments.some((n) => names.includes(n)));
      const endDoctors = doctors.filter((d) => d.endOfReport);
      const pageDoctors = doctors.filter((d) => !d.endOfReport);
      const pageDoctorsH = pageDoctors.length ? Math.max(...pageDoctors.map(doctorHeight)) + 8 : 0;
      return (
      <Page key={key} size="A4" style={[s.page, { paddingLeft: left, paddingRight: right, paddingTop: builtIn ? Math.max(28, headerH + 10) : headerH + 10, paddingBottom: stripBottom + FOOTER_STRIP + pageDoctorsH }]}>
        {look.background ? (
          <Image fixed src={look.background} style={{ position: "absolute", top: 0, left: 0, width: 595.28, height: 841.89 }} />
        ) : null}
        {template.style === "IMAGE" && look.header ? (
          <Image fixed src={look.header} style={{ position: "absolute", top: 0, left: 0, right: 0, height: headerH, objectFit: "contain" }} />
        ) : null}
        {template.style === "IMAGE" && look.footer && footerH > 0 ? (
          <Image fixed src={look.footer} style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: footerH, objectFit: "contain" }} />
        ) : null}

        <View fixed>
          {builtIn ? <BuiltInHeader data={data} look={look} /> : null}
          <View style={[s.patient, builtIn ? {} : { borderTopWidth: 0.75, borderTopColor: RULE }]}>
            {(() => {
              const { fields, labels } = look.headerFields ?? DEFAULT_REPORT_HEADER;
              const items = fields.map((key) => ({
                key,
                label: labels[key]?.trim() || REPORT_HEADER_FIELDS.find((f) => f.key === key)?.label || key,
                value: data.headerValues[key] ?? null,
              }));
              // Two columns, filled in order: the first half down the left, the rest down the right.
              const half = Math.ceil(items.length / 2);
              return [items.slice(0, half), items.slice(half)].map((col, i) => (
                <View key={i} style={s.col}>
                  {col.map((it) => (
                    <KV key={it.key} k={it.label} v={it.value} bold={it.key === "name" || it.key === "orderNo"} />
                  ))}
                </View>
              ));
            })()}
          </View>
          {/* Culture reports carry their own table headings. */}
          {data.departments.every((d) => d.tests.every((t) => t.culture)) && data.departments.length > 0 ? (
            <View style={{ borderBottomWidth: 0.75, borderBottomColor: INK }} />
          ) : (
            <View style={s.thead}>
              <Text style={s.cName}>Test</Text>
              <Text style={s.cValue}>Result</Text>
              <Text style={s.cUnit}>Unit</Text>
              <Text style={s.cRange}>Reference range</Text>
            </View>
          )}
        </View>

        {data.partial ? (
          <Text style={s.banner}>PARTIAL REPORT: some tests are still in progress and will follow.</Text>
        ) : null}
        {data.amended ? <Text style={[s.note, { textAlign: "center" }]}>This report contains amended results and replaces earlier copies.</Text> : null}

        {departments.map((d) => (
          <View key={d.name}>
            <Text style={[s.dept, { color: template.accentColor }]} minPresenceAhead={40}>
              {d.name}
            </Text>
            {d.tests.map((t) => (
              <TestBlock key={t.code} test={t} colours={{ low: template.lowColor, high: template.highColor }} />
            ))}
          </View>
        ))}

        {departments.length === 0 ? <Text style={s.end}>No results have been approved yet.</Text> : null}

        {configured ? (
          endDoctors.length > 0 ? (
            <View style={{ marginTop: 20 }} wrap={false}>
              <DoctorRow doctors={endDoctors} showSignature={showSignature} width={PAGE_W - left - right} />
            </View>
          ) : null
        ) : (
          <View style={s.signs} wrap={false}>
            {data.signatories.map((p) => (
              <Signature key={p.name} person={p} look={look} />
            ))}
          </View>
        )}
        {pageDoctors.length > 0 ? (
          <View fixed style={{ position: "absolute", left, right, bottom: stripBottom + FOOTER_STRIP + 4 }}>
            <DoctorRow doctors={pageDoctors} showSignature={showSignature} width={PAGE_W - left - right} />
          </View>
        ) : null}
        <Text style={s.end}>*** End of report ***</Text>

        <View style={[s.footer, { bottom: stripBottom, left, right }]} fixed>
          {showQr ? <Image src={qr} style={s.qr} /> : null}
          <View style={{ flex: 1, gap: 1 }}>
            {template.footerNote ? <Text style={s.small}>{template.footerNote}</Text> : null}
            <Text style={[s.muted, s.small]}>Results relate only to the sample tested. Please correlate clinically.</Text>
            {showQr && verifyUrl ? <Text style={[s.muted, s.small]}>Scan to verify this report online.</Text> : null}
          </View>
          <Text style={[s.muted, s.small]} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
      );
      })}
    </Document>
  );
}

/** Renders the report as a PDF. verifyUrl, if given, is printed as a QR code. */
export async function renderReportPdf(data: ReportData, verifyUrl: string | null, look: ReportLook = plainLook(), opts: { separate?: boolean } = {}): Promise<Buffer> {
  const qr = verifyUrl && look.template.showQr ? await QRCode.toDataURL(verifyUrl, { margin: 0, width: 160 }) : null;
  return renderToBuffer(
    <FontContext.Provider value={looksFor(look.template.fontFamily)}>
      <Report data={data} qr={qr} verifyUrl={verifyUrl} look={look} separate={opts.separate === true} />
    </FontContext.Provider>,
  );
}
