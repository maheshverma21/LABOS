// A tiny in-memory Redis stand-in for API tests: only the commands the API uses
// (GET/SET EX/DEL/EXISTS/INCR/EXPIRE/PING). Never use it outside tests.
import net from "node:net";

export function startMiniRedis(port) {
  const store = new Map();
  const now = () => Date.now();
  const get = (k) => {
    const e = store.get(k);
    if (!e) return undefined;
    if (e.exp && e.exp < now()) {
      store.delete(k);
      return undefined;
    }
    return e;
  };
  const bulk = (s) => (s == null ? "$-1\r\n" : `$${Buffer.byteLength(s)}\r\n${s}\r\n`);
  const int = (n) => `:${n}\r\n`;
  const ok = "+OK\r\n";

  function exec(args) {
    const cmd = args[0].toUpperCase();
    switch (cmd) {
      case "PING":
        return "+PONG\r\n";
      case "INFO":
        return bulk("# Server\r\nredis_version:7.2.0\r\nloading:0\r\n");
      case "SELECT":
      case "CLIENT":
      case "QUIT":
        return ok;
      case "GET":
        return bulk(get(args[1])?.v ?? null);
      case "SET": {
        let exp = 0;
        for (let i = 3; i < args.length; i++) if (args[i].toUpperCase() === "EX") exp = now() + Number(args[i + 1]) * 1000;
        store.set(args[1], { v: args[2], exp });
        return ok;
      }
      case "DEL": {
        let n = 0;
        for (const k of args.slice(1)) if (store.delete(k)) n++;
        return int(n);
      }
      case "EXISTS":
        return int(args.slice(1).filter((k) => get(k)).length);
      case "INCR": {
        const e = get(args[1]);
        const v = Number(e?.v ?? 0) + 1;
        store.set(args[1], { v: String(v), exp: e?.exp ?? 0 });
        return int(v);
      }
      case "EXPIRE": {
        const e = get(args[1]);
        if (!e) return int(0);
        e.exp = now() + Number(args[2]) * 1000;
        return int(1);
      }
      default:
        return `-ERR unknown command '${cmd}'\r\n`;
    }
  }

  function parse(buf) {
    const out = [];
    let i = 0;
    while (i < buf.length) {
      if (buf[i] !== 42) return { out, rest: buf.subarray(i) };
      const nl = buf.indexOf("\r\n", i);
      if (nl < 0) break;
      const n = Number(buf.subarray(i + 1, nl).toString());
      let j = nl + 2;
      const args = [];
      let complete = true;
      for (let a = 0; a < n; a++) {
        const nl2 = buf.indexOf("\r\n", j);
        if (nl2 < 0) {
          complete = false;
          break;
        }
        const len = Number(buf.subarray(j + 1, nl2).toString());
        if (nl2 + 2 + len + 2 > buf.length) {
          complete = false;
          break;
        }
        args.push(buf.subarray(nl2 + 2, nl2 + 2 + len).toString());
        j = nl2 + 2 + len + 2;
      }
      if (!complete) break;
      out.push(args);
      i = j;
    }
    return { out, rest: buf.subarray(i) };
  }

  const server = net.createServer((sock) => {
    let pending = Buffer.alloc(0);
    sock.on("data", (d) => {
      pending = Buffer.concat([pending, d]);
      const { out, rest } = parse(pending);
      pending = rest;
      for (const args of out) sock.write(exec(args));
    });
    sock.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
