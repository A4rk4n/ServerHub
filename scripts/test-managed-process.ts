import assert from "node:assert/strict";
import { managedExecutablePids,parseManagedProcessProbe,waitForManagedExecutableExit } from "../src/lib/managed-process";
async function main(){
 const managed="C:\\Users\\Server\\AppData\\Roaming\\ServerHub\\tools\\steamcmd\\steamcmd.exe";
 const output=JSON.stringify([{ProcessId:42,ExecutablePath:managed.toUpperCase()},{ProcessId:43,ExecutablePath:"D:\\Other\\steamcmd.exe"},{ProcessId:44,ExecutablePath:null}]);
 assert.deepEqual(parseManagedProcessProbe(output,managed),[42]);assert.deepEqual(parseManagedProcessProbe("",managed),[]);
 let probes=0;const runner=async(command:string,args:string[])=>{assert.equal(command,"powershell.exe");assert.ok(args.join(" ").includes("Win32_Process"));probes++;return{stdout:probes<3?JSON.stringify({ProcessId:42,ExecutablePath:managed}):"[]"}};
 assert.deepEqual(await managedExecutablePids(managed,runner),[42]);
 probes=0;await waitForManagedExecutableExit(managed,new AbortController().signal,{runner,intervalMs:1,timeoutMs:100});assert.equal(probes,3);
 await assert.rejects(waitForManagedExecutableExit(managed,new AbortController().signal,{runner:async()=>({stdout:JSON.stringify({ProcessId:42,ExecutablePath:managed})}),intervalMs:1,timeoutMs:2}),/still running/);
 const otherOnly=async()=>({stdout:JSON.stringify({ProcessId:99,ExecutablePath:"D:\\Unrelated\\steamcmd.exe"})});await waitForManagedExecutableExit(managed,new AbortController().signal,{runner:otherOnly,intervalMs:1,timeoutMs:2});
 console.log("MANAGED_STEAMCMD_PROCESS_GUARD_OK");
}
main().catch(error=>{console.error(error);process.exitCode=1});
