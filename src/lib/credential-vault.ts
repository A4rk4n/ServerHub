import { hostPlatform } from "./host-platform";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run=promisify(execFile);
const PREFIX="dpapi:user:v1:";
export function isProtectedSecret(value:string){return value.startsWith(PREFIX)}
function ps(value:string){return `'${value.replaceAll("'","''")}'`}
export async function protectSecret(value:string){
 if(!value||isProtectedSecret(value))return value;
 if(hostPlatform()!=="win32")throw new Error("Windows DPAPI is available on Windows only");
 const encoded=Buffer.from(value,"utf8").toString("base64");
 const script=`Add-Type -AssemblyName System.Security; $p=[Convert]::FromBase64String(${ps(encoded)}); $e=[Security.Cryptography.ProtectedData]::Protect($p,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($e)`;
 const {stdout}=await run("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});
 const payload=stdout.trim();if(!payload)throw new Error("DPAPI returned an empty encrypted value");return PREFIX+payload;
}
export async function revealSecret(value:string){
 if(!isProtectedSecret(value))return value;
 if(hostPlatform()!=="win32")throw new Error("This credential is protected for a Windows user");
 const payload=value.slice(PREFIX.length);const script=`Add-Type -AssemblyName System.Security; $e=[Convert]::FromBase64String(${ps(payload)}); $p=[Security.Cryptography.ProtectedData]::Unprotect($e,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($p)`;
 const {stdout}=await run("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});return Buffer.from(stdout.trim(),"base64").toString("utf8");
}
export async function protectAndVerify(value:string){const encrypted=await protectSecret(value);if(await revealSecret(encrypted)!==value)throw new Error("DPAPI verification failed");return encrypted}
