import path from "node:path";
export const STEAMCMD_OFFICIAL_URL="https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
export const MAX_TOOL_DOWNLOAD_BYTES=100*1024*1024;
export function assertToolDownloadSize(bytes:number){if(!Number.isFinite(bytes)||bytes<0||bytes>MAX_TOOL_DOWNLOAD_BYTES)throw new Error("Tool download exceeds 100 MB limit")}
export function managedToolFolder(root:string,toolId:string){const folders:Record<string,string>={steamcmd:"steamcmd","hytale-downloader":"hytale-downloader"},folder=folders[toolId];if(!folder)throw new Error("Unknown managed tool identifier");const resolvedRoot=path.resolve(root),target=path.resolve(resolvedRoot,folder),relative=path.relative(resolvedRoot,target);if(!relative||relative.startsWith("..")||path.isAbsolute(relative))throw new Error("Managed tool path was rejected");return target}
export function repairSupported(toolId:string){return toolId==="steamcmd"}
