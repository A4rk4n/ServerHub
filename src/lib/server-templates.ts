export type TemplateSource = {
  gameId:string; version:string; loader:string; memoryMb:number; maxPlayers:number; motd:string; difficulty:string; pvp:boolean;
  bindAddress:string; publicAddress:string; readinessTimeoutSec:number; autoRestart:boolean; maxCrashRestarts:number;
  restartWindowSec:number; autoBackupBeforeUpdate:boolean; updateBackupRetention:number;
};

export function templateConfigFromServer(server:TemplateSource){return {
  gameId:server.gameId,version:server.version,loader:server.loader,memoryMb:server.memoryMb,maxPlayers:server.maxPlayers,motd:server.motd,
  difficulty:server.difficulty,pvp:server.pvp,bindAddress:server.bindAddress,publicAddress:server.publicAddress,
  readinessTimeoutSec:server.readinessTimeoutSec,autoRestart:server.autoRestart,maxCrashRestarts:server.maxCrashRestarts,
  restartWindowSec:server.restartWindowSec,autoBackupBeforeUpdate:server.autoBackupBeforeUpdate,updateBackupRetention:server.updateBackupRetention,
};}

export function nextFreeServerPort(start:number,usedPorts:readonly number[]){const used=new Set(usedPorts);let candidate=Math.max(1024,Math.round(start));while(candidate<=65535&&used.has(candidate))candidate++;if(candidate>65535)throw new Error("No free server port is available");return candidate;}

export const TEMPLATE_EXCLUDED_FIELDS=["serverPassword","adminPassword","ownerId","worldName","seed","port","launchCommand","launchArgs","workingDirectory"] as const;
