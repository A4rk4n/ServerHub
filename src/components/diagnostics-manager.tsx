"use client";
import { Activity, CheckCircle2, Download, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useCallback,useEffect,useState } from "react";
import { Btn } from "./ui";
export function DiagnosticsManager({serverId,accent}:{serverId:number;accent:string}) { const [data,setData]=useState<any>(null); const [loading,setLoading]=useState(false); const [firewall,setFirewall]=useState(""); const refresh=useCallback(async()=>{setLoading(true);try{const r=await fetch(`/api/servers/${serverId}/diagnostics`,{cache:"no-store"});setData(await r.json());}finally{setLoading(false)}},[serverId]); useEffect(()=>{void refresh()},[refresh]); async function resolveIncident(incidentId:number){await fetch(`/api/servers/${serverId}/diagnostics`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"resolve-incident",incidentId})});await refresh();} async function firewallAction(action:"create"|"remove"){if(!confirm(action==="create"?"Create narrowly scoped Windows Defender Firewall rules for the listed game ports? Windows will ask for administrator approval.":"Remove only the Windows Defender Firewall rules created by Server Hub for this server?"))return;setFirewall("Working…");const r=await fetch(`/api/servers/${serverId}/diagnostics`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action})});const j=await r.json();setFirewall(r.ok?(action==="create"?"Firewall rules created.":"Firewall rules removed."):(j.error??"Firewall action failed"));} return <div className="space-y-5"><section className="panel p-5"><div className="flex items-center"><div><h2 className="font-display flex items-center gap-2 text-lg font-bold"><Activity size={18} style={{color:accent}}/>Connectivity & Health Center</h2><p className="mt-1 text-xs text-plum-500">Local adapters, player endpoints, required ports, setup health and redacted support data.</p></div><div className="ml-auto flex gap-2"><Btn variant="subtle" loading={loading} onClick={refresh}><RefreshCw size={14}/>Refresh</Btn><a href={`/api/servers/${serverId}/diagnostics?download=1`}><Btn variant="subtle"><Download size={14}/>JSON report</Btn></a><a href={`/api/servers/${serverId}/diagnostics?bundle=1`}><Btn variant="primary" accent={accent}><Download size={14}/>Support ZIP</Btn></a></div></div></section>{data&&<><div className="grid gap-5 md:grid-cols-2"><section className="panel p-5"><h3 className="mb-3 flex items-center gap-2 font-semibold"><ShieldCheck size={15} style={{color:accent}}/>Connection Center</h3><dl className="space-y-2 text-sm"><Row k="LAN players" v={data.network.lanEndpoint}/><Row k="Internet players" v={data.network.publicEndpoint}/><Row k="Router target" v={data.network.routerTarget}/><Row k="Bind assigned" v={data.checks.bindAddressAssigned?"Yes":"No"}/>{data.network.ports.map((p:any)=><Row key={`${p.protocol}-${p.port}`} k={`${p.name} port`} v={`${p.protocol} ${p.port}`}/>)}</dl><div className="mt-3 flex flex-wrap gap-2"><Btn size="sm" variant="subtle" onClick={()=>void firewallAction("create")}>Create/repair firewall rules</Btn><Btn size="sm" variant="ghost" onClick={()=>void firewallAction("remove")}>Remove rules</Btn></div>{firewall&&<p className="mt-2 text-xs text-plum-600">{firewall}</p>}<div className="mt-3 space-y-1">{data.firewall.ports?.map((p:any)=><p key={`fw-${p.protocol}-${p.port}`} className={p.configured?"text-xs text-emerald-600":"text-xs text-red-500"}>{p.protocol} {p.port}: {p.configured?"enabled inbound Private-profile allow rule detected":"matching enabled inbound Private-profile allow rule not detected"}</p>)}</div><p className="mt-3 text-xs text-plum-500">{data.firewall.natGuidance} External NAT reachability cannot be proven from this PC alone.</p></section><section className="panel p-5"><h3 className="mb-3 font-semibold">Detected LAN adapters</h3><dl className="space-y-2 text-sm">{data.network.adapters.length?data.network.adapters.map((a:any)=><Row key={`${a.name}-${a.address}`} k={a.name} v={a.address}/>):<Row k="Adapters" v="None detected"/>}<Row k="Free disk" v={data.checks.diskFreeMb==null?"Unknown":`${Math.round(data.checks.diskFreeMb/1024)} GB`}/><Row k="OS" v={`${data.platform.os} ${data.platform.release}`}/></dl></section></div><section className="panel p-5"><h3 className="mb-3 font-semibold">Credential vault</h3><dl className="space-y-2 text-sm"><Row k="Provider" v={data.vault.provider}/><Row k="Scope" v={data.vault.scope}/><Row k="Migration" v={data.vault.migrationComplete?"Complete":"Needs attention"}/><Row k="Recovery backup" v={data.vault.recoveryBackupAvailable?"Available":"Not created"}/></dl><p className="mt-3 text-xs text-plum-500">Credentials can only be decrypted by the Windows account that protected them. Reset inaccessible credentials from Settings.</p></section><section className="panel p-5"><h3 className="mb-3 font-semibold">Tool Health Center</h3><div className="grid gap-2 md:grid-cols-2">{data.tools.map((tool:any)=><div key={tool.name} className="flex items-center justify-between rounded-xl border border-candy-100 p-3"><div><p className="text-sm font-medium text-plum-800">{tool.name}</p><p className="max-w-sm truncate font-mono text-[10px] text-plum-400">{tool.path}</p></div><span className={tool.installed?"text-xs font-semibold text-emerald-600":"text-xs font-semibold text-red-500"}>{tool.installed?`Healthy · ${tool.version??"detected"}`:"Missing"}</span></div>)}</div><p className="mt-3 text-xs text-plum-500">Firewall rules detected: {data.firewall.rules.length}. Exact protocol, port, direction, action, enabled state, and Private profile are verified. Installation tools can be reacquired with Repair and retry.</p></section><GuardrailsPanel serverId={serverId} accent={accent}/><section className="panel p-5"><h3 className="mb-3 font-semibold">Health & incidents</h3><dl className="mb-4 space-y-2 text-sm"><Row k="Health" v={data.server.healthStatus??"unknown"}/><Row k="Probe" v={data.server.healthProbe??"none"}/><Row k="Reason" v={data.server.healthReason||"Not checked"}/><Row k="Consecutive failures" v={String(data.server.healthFailures??0)}/></dl><div className="space-y-2">{data.incidents?.slice(0,5).map((item:any)=><div key={item.id} className="rounded-xl border border-candy-100 p-3"><p className="text-sm font-medium text-plum-800">{item.component}: {item.summary}</p><p className="mt-1 text-xs text-plum-500">{item.resolved?"Resolved":"Open"}{!item.resolved&&<button className="ml-2 font-semibold text-pink-600" onClick={()=>void resolveIncident(item.id)}>Mark resolved</button>}{item.remediation?` · ${item.remediation}`:""}</p></div>)}</div></section><section className="panel p-5"><h3 className="mb-3 font-semibold">Setup checklist</h3><div className="grid gap-2 md:grid-cols-2">{data.checks.checklist.map((item:any)=><div key={item.id} className="flex gap-2 rounded-xl border border-candy-100 p-3">{item.ok?<CheckCircle2 size={16} className="shrink-0 text-emerald-600"/>:<XCircle size={16} className="shrink-0 text-red-500"/>}<div><p className="text-sm font-medium text-plum-800">{item.label}</p>{!item.ok&&<p className="mt-1 text-xs text-plum-500">{item.fix}</p>}</div></div>)}</div></section></>}</div> }
function Row({k,v}:{k:string;v:string}){return <div className="flex justify-between gap-4 border-b border-candy-100 pb-2"><dt className="text-plum-500">{k}</dt><dd className="font-mono text-right text-plum-800">{v}</dd></div>}

function GuardrailsPanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [config, setConfig] = useState({ enabled: false, cpuPct: null as number | null, ramMb: null as number | null, sustainMin: 5, action: "notify" as "notify" | "restart" });
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const r = await fetch(`/api/servers/${serverId}/guardrails`, { cache: "no-store" });
        const j = await r.json();
        if (!dead && j.config) { setConfig(j.config); setActive(Boolean(j.active)); }
      } catch {}
    })();
    return () => { dead = true; };
  }, [serverId]);
  async function save() {
    setSaving(true);
    setNote("");
    try {
      const r = await fetch(`/api/servers/${serverId}/guardrails`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(config) });
      const j = await r.json();
      if (!r.ok) setNote(j.error ?? "Could not save guardrails");
      else { setConfig(j.config); setNote("Saved. Thresholds apply within seconds while the server runs."); }
    } catch {
      setNote("Could not save guardrails");
    } finally {
      setSaving(false);
    }
  }
  const num = (value: number | null) => (value === null ? "" : String(value));
  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="font-semibold">Resource guardrails</h3>
        {active && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">triggered</span>}
      </div>
      <p className="mb-4 text-xs text-plum-500">
        Alert when CPU or RAM stays above a threshold for the whole sustain window — short spikes never trigger. Alerts appear here as incidents, in the activity feed, and through webhooks (crash group). The restart action is optional and off by default.
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="flex items-center gap-2 text-sm text-plum-700">
          <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} /> Enabled
        </label>
        <label className="text-xs text-plum-500">CPU above (%)
          <input className="mt-1 w-full rounded-xl border border-candy-200 px-3 py-2 text-sm" inputMode="numeric" placeholder="e.g. 90" value={num(config.cpuPct)} onChange={(e) => setConfig({ ...config, cpuPct: e.target.value.trim() ? Number(e.target.value) : null })} />
        </label>
        <label className="text-xs text-plum-500">RAM above (MB)
          <input className="mt-1 w-full rounded-xl border border-candy-200 px-3 py-2 text-sm" inputMode="numeric" placeholder="e.g. 7000" value={num(config.ramMb)} onChange={(e) => setConfig({ ...config, ramMb: e.target.value.trim() ? Number(e.target.value) : null })} />
        </label>
        <label className="text-xs text-plum-500">Sustained for (min, 1–8)
          <input className="mt-1 w-full rounded-xl border border-candy-200 px-3 py-2 text-sm" inputMode="numeric" value={String(config.sustainMin)} onChange={(e) => setConfig({ ...config, sustainMin: Number(e.target.value) || 5 })} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-plum-700">
          <input type="checkbox" checked={config.action === "restart"} onChange={(e) => setConfig({ ...config, action: e.target.checked ? "restart" : "notify" })} /> Auto-restart on sustained breach
        </label>
        <Btn size="sm" variant="primary" accent={accent} loading={saving} onClick={() => void save()}>Save guardrails</Btn>
        {note && <span className="text-xs text-plum-600">{note}</span>}
      </div>
    </section>
  );
}
