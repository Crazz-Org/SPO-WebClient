/** chooseCompany.asp:23 — `InStr(UCASE(UserName), "MINISTER OF ") = 1`. */
export function isMinisterAccount(username: string): boolean {
  return username.toUpperCase().startsWith('MINISTER OF ');
}
