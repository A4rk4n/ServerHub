/**
 * Historical compatibility hook. The original prototype populated a fake fleet
 * on first run; the production application deliberately starts with an empty
 * database and never creates simulated servers, players, backups, or activity.
 */
export async function ensureSeed(): Promise<void> {
  return;
}
