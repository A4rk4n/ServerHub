export type RequiredPort = { name: string; port: number; protocol: string; required?: boolean };
export type FirewallRuleObservation = { displayName: string; enabled: boolean; direction: string; action: string; profile: string; protocol: string; localPort: string };

export function parseFirewallRules(stdout: string): FirewallRuleObservation[] {
  if (!stdout.trim()) return [];
  const value = JSON.parse(stdout) as Record<string, unknown> | Record<string, unknown>[];
  return (Array.isArray(value) ? value : [value]).map(item => ({
    displayName: String(item.DisplayName ?? ""), enabled: String(item.Enabled).toLowerCase() === "true",
    direction: String(item.Direction ?? ""), action: String(item.Action ?? ""), profile: String(item.Profile ?? ""),
    protocol: String(item.Protocol ?? ""), localPort: String(item.LocalPort ?? ""),
  }));
}
function protocolMatches(observed: string, required: string) { const value=observed.toUpperCase(); const wanted=required.toUpperCase(); return value===wanted||(wanted==="TCP"&&value==="6")||(wanted==="UDP"&&value==="17"); }
export function evaluateFirewallRules(required: RequiredPort[], observed: FirewallRuleObservation[]) {
  const ports=required.map(port=>{const matching=observed.filter(rule=>rule.enabled&&rule.direction.toLowerCase()==="inbound"&&rule.action.toLowerCase()==="allow"&&protocolMatches(rule.protocol,port.protocol)&&rule.localPort.split(",").map(x=>x.trim()).includes(String(port.port)));const privateProfile=matching.some(rule=>/private|any/i.test(rule.profile));return{...port,configured:privateProfile,matchingRules:matching.map(rule=>rule.displayName)};});
  return { configured: ports.every(port=>!port.required||port.configured), ports };
}
