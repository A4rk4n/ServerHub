/** Remove common credential forms before output is persisted or exported. */
export function redactLogSecrets(input: string) {
  return input
    .replace(/\b(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[redacted]")
    .replace(/\b((?:admin|server|world|rcon)?[ _-]?password\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/\b((?:access|refresh|oauth|device)[ _-]?token\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/\b((?:owner|player)[ _-]?id\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/dpapi:user:v1:[A-Za-z0-9+/=_-]+/gi, "[dpapi-redacted]");
}

export function sanitizeSupportText(input: string, privateRoots: string[] = []) {
  let output = input;
  for (const root of [...privateRoots].filter(Boolean).sort((a, b) => b.length - a.length)) output = output.replaceAll(root, "<private-path>");
  output = output
    .replace(/[A-Z]:\\Users\\[^\\\s\"']+/gi, "<user-home>")
    .replace(/\/(?:home|Users)\/[^/\s\"']+/g, "<user-home>");
  return redactLogSecrets(output);
}
