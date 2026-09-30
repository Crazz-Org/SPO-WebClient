/**
 * The live drive's one sleep. A plain, *ref'd* timer on purpose: an unref'd one lets Node
 * exit 0 mid-drive once a flow has closed its last socket (#1181).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
