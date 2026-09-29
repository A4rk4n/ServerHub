export const SUPPORT_BUNDLE_ENTRIES = [
  "summary.json", "diagnostics.json", "readiness.json", "incidents.json",
  "installation-events.json", "console-redacted.txt", "tool-health.json",
  "network.json", "firewall.json", "build-info.json", "SHA256SUMS",
] as const;

const allowed = new Set<string>(SUPPORT_BUNDLE_ENTRIES);
export function assertSupportBundleEntries(names:string[]) {
  const unique=new Set(names);
  if(unique.size!==names.length)throw new Error("Support bundle contains duplicate entries");
  for(const name of names){
    if(name.includes("/")||name.includes("\\")||name.includes("..")||!allowed.has(name))throw new Error(`Support bundle entry is not allowed: ${name}`);
  }
  for(const required of SUPPORT_BUNDLE_ENTRIES)if(!unique.has(required))throw new Error(`Support bundle entry is missing: ${required}`);
}
