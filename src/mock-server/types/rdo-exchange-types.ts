/**
 * RDO-level exchange types for the mock server.
 * These model raw RDO protocol exchanges between Gateway and Game Servers.
 */

/** Fields used to match an incoming RDO request to a captured exchange */
export interface RdoMatchKey {
  verb?: string;          // 'idof' or 'sel'
  targetId?: string;      // Object ID (use '*' for wildcard)
  action?: string;        // 'call', 'get', 'set'
  member?: string;        // Method/property name
  /**
   * The FULL argument list: a frame must carry exactly `argsPattern.length` args, each equal to
   * its position here (quotes ignored). Use `'*'` for a position whose value is not pinned.
   */
  argsPattern?: string[];
}

/** A single RDO exchange: command -> response + optional pushes */
export interface RdoExchange {
  id: string;
  /** The raw RDO command string as sent (C prefix). Empty for server-initiated pushes. */
  request: string;
  /** The raw RDO response string (A prefix). For pushOnly exchanges, this is the push command. */
  response: string;
  /** Optional server push(es) that accompany this exchange */
  pushes?: string[];
  /** Key fields for flexible matching */
  matchKeys?: RdoMatchKey;
  /**
   * The reason this exchange may answer on its member name alone (or, for an `idof` exchange,
   * on the verb alone). Without it, `RdoMock` answers only a frame matching every key
   * `matchKeys` declares. An empty string counts as absent.
   */
  looseMatch?: string;
  /**
   * If true, this exchange is a server-initiated push (no client request).
   * The `response` field contains the push command, and `request` should be ''.
   * Push-only exchanges are NOT matched against incoming requests.
   */
  pushOnly?: boolean;
}

/** A complete RDO scenario with multiple exchanges and variables */
export interface RdoScenario {
  name: string;
  description: string;
  exchanges: RdoExchange[];
  variables: Record<string, string>;
}
