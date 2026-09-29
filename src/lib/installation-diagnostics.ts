export type InstallationDiagnosis = {
  code: string;
  summary: string;
  remediation: string;
  transient: boolean;
};

export function diagnoseInstallationFailure(message: string): InstallationDiagnosis | null {
  if (/failed to install app ['"]?\d+['"]?\s*\(missing configuration\)/i.test(message)) return {
    code: "steam-missing-configuration",
    summary: "Steam does not currently expose an installable configuration for this server app.",
    remediation: "Wait a few minutes and retry. If it persists, verify that the provider's dedicated-server app is currently available for Windows.",
    transient: true,
  };
  if (/failed to install app ['"]?\d+['"]?\s*\(no subscription\)/i.test(message)) return {
    code: "steam-no-subscription",
    summary: "Steam rejected anonymous access to this dedicated-server app.",
    remediation: "Check whether the provider now requires an entitled Steam account or has temporarily withdrawn anonymous server downloads.",
    transient: false,
  };
  if (/timed?\s*out|connection (?:reset|failed)|could not connect|content servers? unreachable|http request failed/i.test(message)) return {
    code: "provider-network",
    summary: "The installation provider could not be reached reliably.",
    remediation: "Check the internet connection and retry. Server Hub automatically retries short provider interruptions.",
    transient: true,
  };
  if (/no space left|not enough space|disk full/i.test(message)) return {
    code: "disk-space",
    summary: "The installation drive does not have enough free space.",
    remediation: "Free disk space or move the managed server location, then retry.",
    transient: false,
  };
  if (/spawn[^\r\n]{0,260}\bEFTYPE\b/i.test(message)) return {
    code: "windows-launch-incompatible",
    summary: "Windows could not launch an installation tool.",
    remediation: "Open Tool Health, repair SteamCMD, and retry the installation.",
    transient: false,
  };
  return null;
}

export function installationFailureMessage(message: string) {
  const diagnosis = diagnoseInstallationFailure(message);
  return diagnosis ? `${diagnosis.summary} ${diagnosis.remediation} [${diagnosis.code}]` : message;
}
