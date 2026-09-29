import fsp from "node:fs/promises";

export type ServerActivationOps = Pick<typeof fsp, "rename" | "rm" | "stat">;
const realOps: ServerActivationOps = fsp;

/** Activate a staged server and retain the prior generation until verification passes. */
export async function activateServerStaging(root: string, staging: string, previous: string, verify: (activatedRoot: string) => Promise<void>, ops: ServerActivationOps = realOps) {
  await ops.rm(previous, { recursive: true, force: true });
  const hadCurrent = await ops.stat(root).then(() => true).catch(() => false);
  if (hadCurrent) await ops.rename(root, previous);
  try {
    await ops.rename(staging, root);
    await verify(root);
  } catch (activationError) {
    await ops.rm(root, { recursive: true, force: true }).catch(() => {});
    if (hadCurrent) {
      try { await ops.rename(previous, root); }
      catch (restoreError) { throw new AggregateError([activationError, restoreError], "Server activation failed and the previous installation could not be restored"); }
    }
    throw activationError;
  }
  if (hadCurrent) await ops.rm(previous, { recursive: true, force: true });
  return { replacedExisting: hadCurrent };
}
