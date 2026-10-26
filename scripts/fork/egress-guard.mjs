// Preloaded with `node --import` by scripts/fork/egress-check.mjs. Records every
// outbound DNS lookup, TCP connect and subprocess spawn of this Node process (and of
// Node children, which inherit NODE_OPTIONS) as JSON lines in $TFREECODE_EGRESS_LOG,
// and fails every non-loopback lookup and connect so nothing actually leaves the host.
import childProcess from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

const logPath = process.env.TFREECODE_EGRESS_LOG;
if (logPath) {
  const record = (entry) => {
    try {
      fs.appendFileSync(
        logPath,
        `${JSON.stringify({ pid: process.pid, script: process.argv[1], ...entry })}\n`,
      );
    } catch {}
  };

  const isLocal = (host) =>
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host.startsWith("127.") ||
    host === "0.0.0.0" ||
    host === "::";

  const originalLookup = dns.lookup;
  dns.lookup = function lookup(hostname, ...rest) {
    if (!isLocal(hostname)) {
      record({ kind: "dns", host: hostname });
      const callback = rest.at(-1);
      const error = Object.assign(new Error(`egress blocked: ${hostname}`), { code: "ENOTFOUND" });
      if (typeof callback === "function") process.nextTick(() => callback(error));
      return {};
    }
    return originalLookup.call(this, hostname, ...rest);
  };
  const originalPromiseLookup = dns.promises.lookup;
  dns.promises.lookup = function lookup(hostname, ...rest) {
    if (!isLocal(hostname)) {
      record({ kind: "dns", host: hostname });
      return Promise.reject(
        Object.assign(new Error(`egress blocked: ${hostname}`), { code: "ENOTFOUND" }),
      );
    }
    return originalPromiseLookup.call(this, hostname, ...rest);
  };

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const [first, second] = args;
    const options = Array.isArray(first) ? first[0] : first;
    const host =
      typeof options === "object" && options !== null
        ? (options.host ?? options.hostname)
        : typeof second === "string"
          ? second
          : undefined;
    const isPipe = typeof options === "object" && options !== null && options.path;
    if (!isPipe && typeof options !== "string" && !isLocal(host)) {
      record({ kind: "tcp", host, port: typeof options === "object" ? options.port : first });
      process.nextTick(() => this.destroy(new Error(`egress blocked: ${host}`)));
      return this;
    }
    return originalConnect.apply(this, args);
  };

  for (const name of ["spawn", "execFile", "exec", "fork"]) {
    const original = childProcess[name];
    childProcess[name] = function (command, ...rest) {
      const args = Array.isArray(rest[0]) ? rest[0] : [];
      record({ kind: "spawn", command: String(command), args: args.map(String).slice(0, 8) });
      return original.call(this, command, ...rest);
    };
  }
  syncBuiltinESMExports();
}
