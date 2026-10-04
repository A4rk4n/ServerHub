// Measured facts for the connection doctor (connection-doctor.ts owns the
// pure verdict logic). Two probes, both side-effect free for the game:
//
// - probePortBound: try to BIND the game's address:port ourselves. If the
//   bind succeeds the port was free (nothing is listening — bad sign), and
//   we close it immediately; if it fails with EADDRINUSE the game holds it
//   (good sign). Works for UDP, where a connect-style check is meaningless.
// - detectPublicIp: ask a public what-is-my-ip endpoint which IP this
//   machine egresses with, so it can be compared against the configured
//   public address (wrong-IP and CGNAT detection).

import dgram from "node:dgram";
import net from "node:net";

export async function probePortBound(protocol: string, host: string, port: number): Promise<boolean | null> {
  try {
    if (protocol.toUpperCase() === "UDP") {
      return await new Promise<boolean | null>((resolve) => {
        const socket = dgram.createSocket("udp4");
        socket.once("error", (error: NodeJS.ErrnoException) => {
          socket.close();
          resolve(error.code === "EADDRINUSE" ? true : null);
        });
        socket.bind(port, host, () => {
          socket.close();
          resolve(false); // we grabbed it — nothing else was listening
        });
      });
    }
    return await new Promise<boolean | null>((resolve) => {
      const probe = net.createServer();
      probe.once("error", (error: NodeJS.ErrnoException) => {
        resolve(error.code === "EADDRINUSE" ? true : null);
      });
      probe.listen(port, host, () => {
        probe.close(() => resolve(false));
      });
    });
  } catch {
    return null;
  }
}

const IP_ENDPOINTS = ["https://api.ipify.org", "https://icanhazip.com"];

export async function detectPublicIp(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  for (const endpoint of IP_ENDPOINTS) {
    try {
      const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(3500) });
      if (!response.ok) continue;
      const ip = (await response.text()).trim();
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return ip;
    } catch {
      /* next endpoint */
    }
  }
  return null;
}
