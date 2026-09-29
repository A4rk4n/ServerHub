import fsp from "node:fs/promises";
import path from "node:path";

export type ToolRepairFileOps = Pick<typeof fsp, "mkdir" | "rename" | "rm" | "stat">;

const realFileOps: ToolRepairFileOps = fsp;

function isMissing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * Atomically replaces a managed tool directory while preserving the previous
 * installation. If activation fails, the previous directory is restored.
 */
export async function activateStagedTool(
  root: string,
  staged: string,
  rollback: string,
  ops: ToolRepairFileOps = realFileOps,
) {
  let rollbackAvailable = false;
  try {
    await ops.rename(root, rollback);
    rollbackAvailable = true;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  await ops.mkdir(path.dirname(root), { recursive: true });
  try {
    await ops.rename(staged, root);
  } catch (activationError) {
    if (rollbackAvailable) {
      try {
        await ops.rename(rollback, root);
      } catch (restoreError) {
        throw new AggregateError(
          [activationError, restoreError],
          "Tool activation failed and the previous installation could not be restored",
        );
      }
    }
    throw activationError;
  }
  return { rollbackAvailable };
}

/**
 * Restores a retained rollback. If restoring it fails after the current tool
 * was moved aside, the current tool is put back before the error is surfaced.
 */
export async function restoreToolRollback(
  root: string,
  rollback: string,
  displaced: string,
  ops: ToolRepairFileOps = realFileOps,
) {
  await ops.stat(rollback);
  let displacedCurrent = false;
  try {
    await ops.rename(root, displaced);
    displacedCurrent = true;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  try {
    await ops.rename(rollback, root);
  } catch (restoreError) {
    if (displacedCurrent) {
      try {
        await ops.rename(displaced, root);
      } catch (recoveryError) {
        throw new AggregateError(
          [restoreError, recoveryError],
          "Rollback failed and the current installation could not be recovered",
        );
      }
    }
    throw restoreError;
  }

  if (displacedCurrent) await ops.rm(displaced, { recursive: true, force: true });
}
