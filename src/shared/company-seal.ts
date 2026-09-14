/**
 * Company seal picture — the cluster's crest the legacy company list drew above
 * the company name (`chooseCompany.asp:186`, `<img src="images/comp-<cluster>.gif">`).
 */

/**
 * Path of a cluster's company seal under the world's IIS root, for `toProxyUrl(path, worldIp)`.
 *
 * The cluster id is passed through unchanged: the shipped files are lower-cased
 * (`comp-pgi.gif`) against ids the server spells `PGI`, and IIS resolves the
 * difference. Nothing is URL-encoded here either — `toProxyUrl` encodes the whole
 * URL (`proxy-utils.ts:51`), which covers the cluster ids carrying a space.
 */
export function companySealPath(cluster: string): string {
  return `/Five/0/Visual/Voyager/NewLogon/images/comp-${cluster}.gif`;
}
