import os from "node:os";

export function validateDragonwildsPreflight(ownerId: string, adminPassword: string) {
  const owner = ownerId.trim();
  if (!owner) throw new Error("Dragonwilds requires the owner's in-game Player ID before installation.");
  if (owner.length > 200 || /[\r\n\0]/.test(owner)) throw new Error("Dragonwilds Player ID contains unsupported characters or is too long.");
  if (adminPassword.length < 5) throw new Error("Dragonwilds requires an admin password of at least five characters.");
  if (/[\r\n\0]/.test(adminPassword)) throw new Error("Dragonwilds admin password cannot contain line breaks or null characters.");
}

export function assignedLocalAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()) {
  const addresses = new Set(["0.0.0.0", "127.0.0.1", "::", "::1"]);
  for (const entries of Object.values(interfaces)) for (const entry of entries ?? []) addresses.add(entry.address.split("%")[0].toLowerCase());
  return addresses;
}

export function isAssignedLocalAddress(address: string, interfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>) {
  return assignedLocalAddresses(interfaces).has(address.trim().toLowerCase().split("%")[0]);
}
