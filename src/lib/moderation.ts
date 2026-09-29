export const MINECRAFT_MODERATION_ACTIONS=["kick","ban","unban","op","deop"] as const;
export type ModerationAction=typeof MINECRAFT_MODERATION_ACTIONS[number];
export function moderationCommand(gameId:string,action:string,playerName:string,reason=""){
  if(!gameId.startsWith("minecraft"))throw new Error("Moderation commands are not supported for this provider");
  if(!MINECRAFT_MODERATION_ACTIONS.includes(action as ModerationAction))throw new Error("Unknown moderation action");
  if(!/^[A-Za-z0-9_]{1,16}$/.test(playerName))throw new Error("Player name is not safe for a Minecraft command");
  const cleanReason=reason.trim().replace(/[\r\n]/g," ").slice(0,120);if(/[;\x00]/.test(cleanReason))throw new Error("Moderation reason contains unsafe characters");
  if(action==="kick")return `kick ${playerName}${cleanReason?` ${cleanReason}`:""}`;
  if(action==="ban")return `ban ${playerName}${cleanReason?` ${cleanReason}`:""}`;
  return `${action==="unban"?"pardon":action} ${playerName}`;
}
