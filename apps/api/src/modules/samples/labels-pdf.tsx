import { Document, Page, Rect, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import JsBarcode from "jsbarcode";
import { ageOn, formatAge, SEX_SHORT, todayIST, type OrderDetail } from "@lms/shared";

const MM = 2.8346457; // points per millimetre
const W = 50 * MM;
const H = 25 * MM;

const styles = StyleSheet.create({
  page: { width: W, height: H, paddingHorizontal: 2.5 * MM, paddingVertical: 1.5 * MM, fontSize: 6.5, fontFamily: "Helvetica", color: "#000" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontFamily: "Helvetica-Bold" },
  bars: { alignItems: "center", marginTop: 1 },
});

/** Code 128 as a row of SVG bars. */
function Bars({ value, width, height }: { value: string; width: number; height: number }) {
  const holder: { encodings?: { data: string }[] } = {};
  JsBarcode(holder, value, { format: "CODE128" });
  const modules = holder.encodings?.map((e) => e.data).join("") ?? "";
  const unit = width / modules.length;
  const rects: { x: number; w: number }[] = [];
  for (let i = 0; i < modules.length; ) {
    if (modules[i] !== "1") {
      i++;
      continue;
    }
    let j = i;
    while (modules[j] === "1") j++;
    rects.push({ x: i * unit, w: (j - i) * unit });
    i = j;
  }
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {rects.map((r, k) => (
        <Rect key={k} x={r.x} y={0} width={r.w} height={height} fill="#000" />
      ))}
    </Svg>
  );
}

type Sample = OrderDetail["samples"][number];

/** One 50 x 25 mm label per sample, one label per page. */
export function renderLabelsPdf(order: OrderDetail, samples: Sample[]) {
  const age = formatAge(ageOn(order.patient.dob, todayIST(new Date(order.createdAt))));
  const day = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(order.createdAt));
  return renderToBuffer(
    <Document title={`Barcodes ${order.orderNo}`}>
      {samples.map((s) => (
        <Page key={s.id} size={[W, H]} style={styles.page}>
          <View style={styles.row}>
            <Text style={styles.bold}>{order.patient.name.length > 22 ? `${order.patient.name.slice(0, 20)}..` : order.patient.name}</Text>
            <Text style={styles.bold}>
              {age}/{SEX_SHORT[order.patient.sex]}
            </Text>
          </View>
          <View style={styles.bars}>
            <Bars value={s.barcode} width={W - 5 * MM} height={9 * MM} />
          </View>
          <View style={styles.row}>
            <Text style={styles.bold}>{s.barcode}</Text>
            <Text>{day}</Text>
          </View>
          <Text>
            {(s.container ?? s.sampleType).split(" (")[0]} · {s.tests.map((t) => t.code).join(" ")}
          </Text>
        </Page>
      ))}
    </Document>,
  );
}
