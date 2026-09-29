import assert from "node:assert/strict";
import { assertSafeManagedSignature, classifyAuthenticode, verifyWindowsAuthenticode } from "../src/lib/windows-authenticode";

async function main(){
const valid=classifyAuthenticode({Status:"Valid",StatusMessage:"Signature verified",Subject:"CN=Valve Corp.",Thumbprint:"aa bb-12"});
assert.deepEqual(valid,{state:"valid",publisher:"CN=Valve Corp.",thumbprint:"AABB12",detail:"Signature verified"});
assert.doesNotThrow(()=>assertSafeManagedSignature(valid));
const unsigned=classifyAuthenticode({Status:"NotSigned",StatusMessage:"Not signed"});
assert.equal(unsigned.state,"unsigned");
assert.doesNotThrow(()=>assertSafeManagedSignature(unsigned));
for(const status of ["HashMismatch","NotTrusted","UnknownError"]){const result=classifyAuthenticode({Status:status,StatusMessage:"bad"});assert.equal(result.state,"invalid");assert.throws(()=>assertSafeManagedSignature(result),/invalid Authenticode/)}
const injected=await verifyWindowsAuthenticode("C:\\staged\\steamcmd.exe",async(command,args)=>{assert.equal(command,"powershell.exe");assert.ok(args.join(" ").includes("Get-AuthenticodeSignature"));return{stdout:JSON.stringify({Status:"Valid",Subject:"CN=Valve Corp.",Thumbprint:"ABC123"})}});
assert.equal(injected.state,"valid");
const unavailable=await verifyWindowsAuthenticode("C:\\staged\\steamcmd.exe",async()=>{throw new Error("PowerShell unavailable")});
assert.equal(unavailable.state,"unavailable");assert.throws(()=>assertSafeManagedSignature(unavailable),/unavailable/);
console.log("AUTHENTICODE_POLICY_REGRESSION_OK");

}
main().catch(error=>{console.error(error);process.exitCode=1});
