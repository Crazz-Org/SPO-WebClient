import { companySealPath } from './company-seal';
import { toProxyUrl } from './proxy-utils';

describe('companySealPath', () => {
  it('builds the path chooseCompany.asp:186 draws', () => {
    expect(companySealPath('PGI')).toBe('/Five/0/Visual/Voyager/NewLogon/images/comp-PGI.gif');
  });

  it('passes the cluster id through unchanged — IIS resolves the case, we must not guess it', () => {
    // The shipped file is comp-pgi.gif; lower-casing here would be a second rule
    // to keep in sync with a directory listing nobody can read from the client.
    expect(companySealPath('PGI')).toContain('comp-PGI.gif');
    expect(companySealPath('Heavy Industry')).toBe(
      '/Five/0/Visual/Voyager/NewLogon/images/comp-Heavy Industry.gif',
    );
  });

  it('leaves encoding to toProxyUrl, so a cluster with a space survives the round trip', () => {
    const url = toProxyUrl(companySealPath('Heavy Industry'), '1.2.3.4');
    expect(url).toBe(
      '/proxy-image?url=' +
        encodeURIComponent('http://1.2.3.4/Five/0/Visual/Voyager/NewLogon/images/comp-Heavy Industry.gif'),
    );
    expect(url).toContain('Heavy%20Industry');
  });
});
