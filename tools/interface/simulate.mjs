#!/usr/bin/env node
/**
 * Pretends to be an analyzer: sends one result message to the LabOS
 * interface, the way a real machine does. For trying the setup without a machine.
 *
 *   node tools/interface/simulate.mjs --port 5100 --barcode 261031000101
 *   node tools/interface/simulate.mjs --port 5101 --barcode 261031000102 --protocol hl7 --values "GLU=96,CREAT=0.9"
 *
 * --protocol astm (default: framed, with ENQ/ACK), astm-plain (no framing) or hl7 (MLLP)
 * --values   CODE=value pairs; the default is a full blood count with Sysmex-style codes.
 */
import { connect } from "node:net";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const host = arg("host", "127.0.0.1");
const port = Number(arg("port", "5100"));
const barcode = arg("barcode");
const protocol = arg("protocol", "astm");
if (!barcode) {
  console.error("Give the tube's barcode: --barcode 261031000101");
  process.exit(1);
}
const CBC = "WBC=7.8,RBC=4.6,HGB=10.4,HCT=40.1,MCV=84,MCH=27.5,MCHC=32.6,RDW-CV=13.1,PLT=245,NEUT%=58,LYMPH%=32,MONO%=6,EO%=3,BASO%=1";
const values = arg("values", CBC)
  .split(",")
  .map((p) => p.split("="))
  .filter(([c, v]) => c && v);
const UNITS = { WBC: "10*3/uL", RBC: "10*6/uL", HGB: "g/dL", HCT: "%", MCV: "fL", MCH: "pg", MCHC: "g/dL", PLT: "10*3/uL", GLU: "mg/dL", CREAT: "mg/dL" };
const now = new Date().toISOString().replace(/\D/g, "").slice(0, 14);

function astmRecords() {
  return [
    `H|\\^&|||Simulator^1.0|||||||P|1|${now}`,
    `P|1`,
    `O|1|${barcode}^1^1||^^^CBC|R|${now}|||||N`,
    ...values.map(([code, value], i) => `R|${i + 1}|^^^^${code}^1|${value}|${UNITS[code.replace("%", "")] ?? (code.endsWith("%") ? "%" : "")}||N||F||||${now}`),
    `L|1|N`,
  ];
}

function hl7Message() {
  return [
    `MSH|^~\\&|Simulator|Lab|LabOS|Lab|${now}||ORU^R01|SIM${Date.now()}|P|2.3.1`,
    `PID|1||||Test^Patient`,
    `OBR|1|${barcode}|${barcode}|^Chemistry|||${now}`,
    ...values.map(([code, value], i) => `OBX|${i + 1}|NM|${code}^${code}||${value}|${UNITS[code] ?? ""}|||||F`),
  ].join("\r");
}

const socket = connect({ host, port });
const wait = () => new Promise((ok) => socket.once("data", (d) => ok(d)));
socket.on("error", (err) => {
  console.error(`Couldn't reach the interface on ${host}:${port}: ${err.message}. Is it running, with an analyzer set to that port?`);
  process.exit(1);
});
socket.on("connect", async () => {
  if (protocol === "hl7") {
    socket.write(Buffer.concat([Buffer.from([0x0b]), Buffer.from(hl7Message(), "latin1"), Buffer.from([0x1c, 0x0d])]));
    const ack = (await wait()).toString("latin1").replace(/[\x0b\x1c]/g, "").replace(/\r/g, "\n").trim();
    console.log(`Sent HL7 results for ${barcode}. Reply:\n${ack}`);
  } else if (protocol === "astm-plain") {
    socket.write(astmRecords().join("\r") + "\r");
    console.log(`Sent plain ASTM results for ${barcode}.`);
    await new Promise((r) => setTimeout(r, 300));
  } else {
    socket.write(Buffer.from([0x05]));
    if ((await wait())[0] !== 0x06) throw new Error("The interface didn't accept ENQ");
    const records = astmRecords();
    for (const [i, rec] of records.entries()) {
      const fn = String((i + 1) % 8);
      const body = Buffer.from(`${fn}${rec}\r\x03`, "latin1");
      let sum = 0;
      for (const b of body) sum += b;
      socket.write(Buffer.concat([Buffer.from([0x02]), body, Buffer.from((sum & 0xff).toString(16).toUpperCase().padStart(2, "0") + "\r\n", "latin1")]));
      if ((await wait())[0] !== 0x06) throw new Error(`Frame ${i + 1} wasn't acknowledged`);
    }
    socket.write(Buffer.from([0x04]));
    console.log(`Sent ASTM results for ${barcode} (${values.length} values, ${records.length} frames, all acknowledged).`);
  }
  socket.end();
});
