import "server-only";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Network, type NetworkFile } from "@/lib/core/network";

// The network built by scripts/build-network.ts, loaded once per server
// instance (~100 ms) and again if the file is rebuilt. The same file is
// served to browsers for offline use.

const FILE = path.join(process.cwd(), "public/network/network.json.gz");
let net: { mtime: number; p: Promise<Network> } | null = null;

export async function getNetwork(): Promise<Network> {
  const mtime = (await stat(FILE)).mtimeMs;
  if (net?.mtime !== mtime) {
    const p = readFile(FILE).then(
      (buf) =>
        new Network(
          JSON.parse(gunzipSync(buf).toString("utf8")) as NetworkFile,
        ),
    );
    net = { mtime, p };
    p.catch(() => {
      if (net?.p === p) net = null;
    });
  }
  return net.p;
}
