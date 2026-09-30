// Which Java runtime a given Minecraft: Java Edition version needs.
//
// Mojang's requirements (class-file version in parentheses):
//   1.16 and older        -> Java 8  (52)
//   1.17 – 1.20.4         -> Java 17 (61; 1.17 itself needs 16, 17 works)
//   1.20.5 – 1.21.x       -> Java 21 (65)
//   26.1 and newer        -> Java 25 (69) — Mojang switched to calendar
//                            versioning (YY.N) in 2026, right after 1.21.
//
// The old implementation assumed every version looked like "1.x.y" and
// defaulted anything else to Java 8 — so the current "26.x" releases and
// snapshots were launched under Java 8 and crashed with
// UnsupportedClassVersionError (class file version 69.0 vs 52.0).
// Unknown or future versions now resolve to the NEWEST runtime instead:
// modern JVMs run older class files, while the reverse always fails.

export const LATEST_JAVA_MAJOR = 25;

export function javaMajorForMinecraft(version: string): number {
  const v = version.trim().toLowerCase();

  // Legacy scheme: "1.minor[.patch]" with optional suffixes (-pre1, -rc1).
  const legacy = /^1\.(\d+)(?:\.(\d+))?/.exec(v);
  if (legacy) {
    const minor = Number(legacy[1]);
    const patch = Number(legacy[2] ?? "0");
    if (minor <= 16) return 8;
    if (minor < 20 || (minor === 20 && patch <= 4)) return 17;
    if (minor <= 21) return 21;
    return LATEST_JAVA_MAJOR;
  }

  // Calendar scheme since 2026: "26.1", "26.4-snapshot-1", …
  const calendar = /^(\d{2})\.\d+/.exec(v);
  if (calendar && Number(calendar[1]) >= 26) return LATEST_JAVA_MAJOR;

  // Weekly snapshots: "24w14a", "21w37a", … — mapped by development era.
  const weekly = /^(\d{2})w\d{2}/.exec(v);
  if (weekly) {
    const year = Number(weekly[1]);
    if (year <= 20) return 8; // pre-1.17 development
    if (year <= 23) return 17; // 1.17 – 1.20.4 development
    if (year <= 25) return 21; // 1.20.5 – 1.21.x development
    return LATEST_JAVA_MAJOR;
  }

  // Anything unrecognized gets the newest runtime, never the oldest.
  return LATEST_JAVA_MAJOR;
}
