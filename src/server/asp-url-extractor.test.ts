import {
  resolveUrl,
  deriveKey,
  extractFormActions,
  extractHrefUrls,
  extractOnClickUrls,
  extractScriptNavigateUrls,
  extractAllActionUrls,
  extractMapCoords,
} from './asp-url-extractor';

const BASE_URL = 'http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/TycoonPolicy.asp?Tycoon=Test&DAPort=7001';

describe('asp-url-extractor', () => {
  // ===== resolveUrl =====
  describe('resolveUrl', () => {
    it('returns absolute URLs unchanged', () => {
      expect(resolveUrl('http://1.2.3.4/page.asp?x=1', BASE_URL))
        .toBe('http://1.2.3.4/page.asp?x=1');
    });

    it('returns https absolute URLs unchanged', () => {
      expect(resolveUrl('https://example.com/page.asp', BASE_URL))
        .toBe('https://example.com/page.asp');
    });

    it('resolves root-relative URLs', () => {
      expect(resolveUrl('/Five/0/Visual/Voyager/other.asp?a=1', BASE_URL))
        .toBe('http://158.69.153.134/Five/0/Visual/Voyager/other.asp?a=1');
    });

    it('resolves same-directory relative URLs', () => {
      expect(resolveUrl('resetTycoon.asp?Tycoon=X', BASE_URL))
        .toBe('http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/resetTycoon.asp?Tycoon=X');
    });

    it('resolves parent-directory relative URLs (../)', () => {
      expect(resolveUrl('../Politics/popularratings.asp?TownName=X', BASE_URL))
        .toBe('http://158.69.153.134/Five/0/Visual/Voyager/Politics/popularratings.asp?TownName=X');
    });

    it('resolves protocol-relative URLs', () => {
      expect(resolveUrl('//other.host/path.asp', BASE_URL))
        .toBe('http://other.host/path.asp');
    });

    it('trims whitespace', () => {
      expect(resolveUrl('  http://host/page.asp  ', BASE_URL))
        .toBe('http://host/page.asp');
    });

    it('handles base URL without path', () => {
      expect(resolveUrl('page.asp', 'http://host'))
        .toBe('http://host/page.asp');
    });
  });

  // ===== deriveKey =====
  describe('deriveKey', () => {
    it('extracts ASP filename from full URL', () => {
      expect(deriveKey('http://1.2.3.4/Five/0/Visual/Voyager/NewTycoon/TycoonPolicy.asp?Action=modify&DAPort=7001'))
        .toBe('TycoonPolicy.asp');
    });

    it('extracts filename from path without query string', () => {
      expect(deriveKey('http://host/path/to/resetTycoon.asp'))
        .toBe('resetTycoon.asp');
    });

    it('handles URL with no path segments', () => {
      expect(deriveKey('file.asp')).toBe('file.asp');
    });

    it('returns original URL if no filename found', () => {
      expect(deriveKey('')).toBe('');
    });
  });

  // ===== extractFormActions =====
  describe('extractFormActions', () => {
    it('extracts form action URL and hidden fields', () => {
      const html = `
        <form action="TycoonPolicy.asp?Action=modify&DAAddr=1.2.3.4&DAPort=1100" method="POST">
          <input type="hidden" name="WorldName" value="Shamba">
          <input type="hidden" name="TycoonId" value="12345">
          <select name="status"><option value="0">Ally</option></select>
          <input type="submit" value="Set">
        </form>`;

      const results = extractFormActions(html, BASE_URL);
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('TycoonPolicy.asp');
      expect(results[0].url).toContain('TycoonPolicy.asp?Action=modify&DAAddr=1.2.3.4&DAPort=1100');
      expect(results[0].method).toBe('POST');
      expect(results[0].hiddenFields).toEqual({
        WorldName: 'Shamba',
        TycoonId: '12345',
      });
    });

    it('extracts multiple forms', () => {
      const html = `
        <form action="loan.asp?DAPort=7001" method="POST">
          <input type="hidden" name="Action" value="LOAN">
        </form>
        <form action="send.asp?DAPort=7001" method="POST">
          <input type="hidden" name="Action" value="SEND">
        </form>`;

      const results = extractFormActions(html, BASE_URL);
      expect(results).toHaveLength(2);
      expect(results[0].key).toBe('loan.asp');
      expect(results[1].key).toBe('send.asp');
    });

    it('handles form with GET method', () => {
      const html = '<form action="search.asp" method="GET"></form>';
      const results = extractFormActions(html, BASE_URL);
      expect(results).toHaveLength(1);
      expect(results[0].method).toBe('GET');
    });

    it('defaults to POST when method is absent', () => {
      const html = '<form action="update.asp"></form>';
      const results = extractFormActions(html, BASE_URL);
      expect(results).toHaveLength(1);
      expect(results[0].method).toBe('POST');
    });

    it('handles single-quoted attributes', () => {
      const html = "<form action='page.asp?DAPort=9000' method='post'></form>";
      const results = extractFormActions(html, BASE_URL);
      expect(results).toHaveLength(1);
      expect(results[0].url).toContain('page.asp?DAPort=9000');
    });

    it('handles unquoted action attribute', () => {
      const html = '<form action=page.asp method=post></form>';
      const results = extractFormActions(html, BASE_URL);
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('page.asp');
    });

    it('resolves relative form action URLs', () => {
      const html = '<form action="../Other/action.asp?x=1" method="post"></form>';
      const results = extractFormActions(html, BASE_URL);
      expect(results).toHaveLength(1);
      expect(results[0].url).toBe(
        'http://158.69.153.134/Five/0/Visual/Voyager/Other/action.asp?x=1',
      );
    });

    it('skips forms without action attribute', () => {
      const html = '<form method="post"><input type="text"></form>';
      const results = extractFormActions(html, BASE_URL);
      expect(results).toHaveLength(0);
    });

    it('returns no hiddenFields when none exist', () => {
      const html = '<form action="page.asp" method="post"><input type="submit"></form>';
      const results = extractFormActions(html, BASE_URL);
      expect(results[0].hiddenFields).toBeUndefined();
    });

    it('returns empty array for empty/null input', () => {
      expect(extractFormActions('', BASE_URL)).toEqual([]);
      expect(extractFormActions(null as unknown as string, BASE_URL)).toEqual([]);
    });

    it('handles hidden fields with empty values', () => {
      const html = '<form action="page.asp"><input type="hidden" name="RIWS" value=""></form>';
      const results = extractFormActions(html, BASE_URL);
      expect(results[0].hiddenFields).toEqual({ RIWS: '' });
    });
  });

  // ===== extractHrefUrls =====
  describe('extractHrefUrls', () => {
    it('extracts ASP links', () => {
      const html = `
        <a href="resetTycoon.asp?Tycoon=X&DAPort=7001">Reset</a>
        <a href="abandonRole.asp?Tycoon=X&DAPort=7001">Abandon</a>
        <a href="styles.css">Stylesheet</a>`;

      const results = extractHrefUrls(html, BASE_URL);
      expect(results).toHaveLength(2);
      expect(results[0].key).toBe('resetTycoon.asp');
      expect(results[1].key).toBe('abandonRole.asp');
      expect(results[0].method).toBe('GET');
    });

    it('applies path filter', () => {
      const html = `
        <a href="resetTycoon.asp?x=1">Reset</a>
        <a href="abandonRole.asp?x=1">Abandon</a>
        <a href="other.asp?x=1">Other</a>`;

      const results = extractHrefUrls(html, BASE_URL, /resetTycoon|abandonRole/i);
      expect(results).toHaveLength(2);
    });

    it('skips non-ASP links', () => {
      const html = '<a href="page.html">Link</a><a href="app.js">JS</a>';
      const results = extractHrefUrls(html, BASE_URL);
      expect(results).toHaveLength(0);
    });

    it('skips fragment and javascript: links', () => {
      const html = `
        <a href="#section">Anchor</a>
        <a href="javascript:void(0)">JS</a>`;
      const results = extractHrefUrls(html, BASE_URL);
      expect(results).toHaveLength(0);
    });

    it('handles single-quoted href', () => {
      const html = "<a href='page.asp?DAPort=9000'>Link</a>";
      const results = extractHrefUrls(html, BASE_URL);
      expect(results).toHaveLength(1);
    });

    it('resolves relative href URLs', () => {
      const html = '<a href="../Politics/vote.asp?town=X">Vote</a>';
      const results = extractHrefUrls(html, BASE_URL);
      expect(results[0].url).toBe(
        'http://158.69.153.134/Five/0/Visual/Voyager/Politics/vote.asp?town=X',
      );
    });

    it('resolves absolute href URLs', () => {
      const html = '<a href="http://other.host/page.asp?x=1">Link</a>';
      const results = extractHrefUrls(html, BASE_URL);
      expect(results[0].url).toBe('http://other.host/page.asp?x=1');
    });

    it('returns empty array for empty input', () => {
      expect(extractHrefUrls('', BASE_URL)).toEqual([]);
    });
  });

  // ===== extractOnClickUrls =====
  describe('extractOnClickUrls', () => {
    it('extracts location.href assignment', () => {
      const html = `<button onclick="location.href='DeleteDefaultSupplier.asp?FluidId=123&DAPort=7001'">Delete</button>`;
      const results = extractOnClickUrls(html, BASE_URL);
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('DeleteDefaultSupplier.asp');
      expect(results[0].url).toContain('FluidId=123&DAPort=7001');
      expect(results[0].method).toBe('GET');
    });

    it('extracts window.location assignment', () => {
      const html = `<select onchange="window.location='ModifyTradeCenterStatus.asp?Hire=true&DAPort=7001'">`;
      const results = extractOnClickUrls(html, BASE_URL);
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('ModifyTradeCenterStatus.asp');
    });

    it('extracts document.location assignment', () => {
      const html = `<div onclick="document.location='page.asp?x=1'">Click</div>`;
      const results = extractOnClickUrls(html, BASE_URL);
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('page.asp');
    });

    it('extracts navigate() call', () => {
      const html = `<button onclick="navigate('ModifyWarehouseStatus.asp?Only=true')">Toggle</button>`;
      const results = extractOnClickUrls(html, BASE_URL);
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('ModifyWarehouseStatus.asp');
    });

    it('skips non-ASP URLs in handlers', () => {
      const html = `<button onclick="location.href='page.html'">Link</button>`;
      const results = extractOnClickUrls(html, BASE_URL);
      expect(results).toHaveLength(0);
    });

    it('handles single-quoted event attributes with double-quoted URLs', () => {
      const html = `<button onclick='document.location="page.asp?x=1"'>Click</button>`;
      const results = extractOnClickUrls(html, BASE_URL);
      expect(results).toHaveLength(1);
    });

    it('resolves relative URLs in handlers', () => {
      const html = `<button onclick="location.href='../Other/action.asp?x=1'">Go</button>`;
      const results = extractOnClickUrls(html, BASE_URL);
      expect(results[0].url).toBe(
        'http://158.69.153.134/Five/0/Visual/Voyager/Other/action.asp?x=1',
      );
    });

    it('returns empty array for empty input', () => {
      expect(extractOnClickUrls('', BASE_URL)).toEqual([]);
    });

    it('returns empty for handlers without URL patterns', () => {
      const html = `<button onclick="alert('hello')">Click</button>`;
      const results = extractOnClickUrls(html, BASE_URL);
      expect(results).toHaveLength(0);
    });
  });

  // ===== extractScriptNavigateUrls =====
  describe('extractScriptNavigateUrls', () => {
    it('extracts URL from onAdvanceClick with getBaseURL()', () => {
      const html = `<html><head><script language="JScript">
        function getBaseURL()
        {
          return (
            "http://" +
            "158.69.153.134:80" + "/" +
            "/Five/0/Visual/Voyager/NewTycoon/"
            )
        }

        function onAdvanceClick()
        {
          var URL = getBaseURL() +
            "rdoSetAdvanceLevel.asp" +
            "?TycoonId=132445236" +
            "&Password=SIMCITY99" +
            "&Value=" + event.srcElement.checked +
            "&WorldName=Shamba" +
            "&DAAddr=158.69.153.134" +
            "&DAPort=7001" +
            "&Tycoon=SPO_test3";
          hiddenFrame.navigate( URL );
        }
      </script></head></html>`;

      const results = extractScriptNavigateUrls(html, BASE_URL);
      // Should find the advance level URL
      const advance = results.find(r => r.key === 'rdoSetAdvanceLevel.asp');
      expect(advance).toBeDefined();
      expect(advance!.url).toContain('TycoonId=132445236');
      expect(advance!.url).toContain('Password=SIMCITY99');
      expect(advance!.url).toContain('DAPort=7001');
      expect(advance!.url).toContain('Tycoon=SPO_test3');
      // Value= is empty because event.srcElement.checked is a JS expression, not a string literal
      expect(advance!.url).toContain('Value=');
      expect(advance!.method).toBe('GET');
    });

    it('extracts simple string URL from script block', () => {
      const html = `<html><head><script language="JScript">
        function onBtnClick()
        {
          switch (td.command)
          {
            case "reset" :
              var URL = "resetTycoon.asp?Tycoon=SPO_test3&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&TycoonId=&Password=SIMCITY99";
              window.navigate(URL);
              break;
          }
        }
      </script></head></html>`;

      const results = extractScriptNavigateUrls(html, BASE_URL);
      const reset = results.find(r => r.key === 'resetTycoon.asp');
      expect(reset).toBeDefined();
      expect(reset!.url).toContain('Tycoon=SPO_test3');
      expect(reset!.url).toContain('DAPort=7001');
    });

    it('returns empty array for script without .asp URLs', () => {
      const html = `<script>var x = "hello"; var y = 42;</script>`;
      const results = extractScriptNavigateUrls(html, BASE_URL);
      expect(results).toHaveLength(0);
    });

    it('returns empty array for empty input', () => {
      expect(extractScriptNavigateUrls('', BASE_URL)).toEqual([]);
    });

    it('handles HTML without script blocks', () => {
      const html = '<html><body><p>No scripts</p></body></html>';
      const results = extractScriptNavigateUrls(html, BASE_URL);
      expect(results).toHaveLength(0);
    });
  });

  // ===== extractAllActionUrls =====
  describe('extractAllActionUrls', () => {
    it('merges results from all extractors', () => {
      const html = `
        <form action="TycoonPolicy.asp?Action=modify&DAPort=7001" method="post">
          <input type="hidden" name="WorldName" value="Shamba">
        </form>
        <a href="resetTycoon.asp?DAPort=7001">Reset</a>
        <button onclick="location.href='DeleteDefaultSupplier.asp?DAPort=7001'">Delete</button>`;

      const map = extractAllActionUrls(html, BASE_URL);
      expect(map.size).toBe(3);
      expect(map.has('TycoonPolicy.asp')).toBe(true);
      expect(map.has('resetTycoon.asp')).toBe(true);
      expect(map.has('DeleteDefaultSupplier.asp')).toBe(true);

      // Form preserves method and hidden fields
      const policy = map.get('TycoonPolicy.asp')!;
      expect(policy.method).toBe('POST');
      expect(policy.hiddenFields?.WorldName).toBe('Shamba');
    });

    it('later entries overwrite earlier ones for same key', () => {
      const html = `
        <form action="page.asp?source=form" method="post"></form>
        <a href="page.asp?source=link">Link</a>`;

      const map = extractAllActionUrls(html, BASE_URL);
      expect(map.size).toBe(1);
      // Link overwrites form (href extracted after forms)
      expect(map.get('page.asp')!.url).toContain('source=link');
    });

    it('applies hrefFilter to link extraction', () => {
      const html = `
        <a href="reset.asp?x=1">Reset</a>
        <a href="other.asp?x=1">Other</a>`;

      const map = extractAllActionUrls(html, BASE_URL, /reset/i);
      expect(map.has('reset.asp')).toBe(true);
      expect(map.has('other.asp')).toBe(false);
    });

    it('returns empty map for empty HTML', () => {
      expect(extractAllActionUrls('', BASE_URL).size).toBe(0);
    });
  });

  // ===== Realistic ASP page scenarios =====
  describe('realistic ASP page scenarios', () => {
    it('handles a policy page with form and per-tycoon selects', () => {
      const html = `
<html><body>
<form name="policyForm" action="http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/TycoonPolicy.asp?Action=modify&WorldName=Shamba&Tycoon=TestPlayer&TycoonId=131655160&Password=test123&DAAddr=158.69.153.134&DAPort=7001" method="post">
  <input type="hidden" name="Subject" value="">
  <table>
    <tr>
      <td><div class=label style="color: #94B9B0">RivalTycoon</div></td>
      <td><select tycoon="RivalTycoon" onchange="submitPolicy(this)">
        <option value="0">Ally</option>
        <option value="1" selected>Neutral</option>
        <option value="2">Enemy</option>
      </select></td>
      <td><span id=otherspan0>N</span></td>
    </tr>
  </table>
</form>
</body></html>`;

      const results = extractFormActions(html, BASE_URL);
      expect(results).toHaveLength(1);

      const form = results[0];
      expect(form.key).toBe('TycoonPolicy.asp');
      expect(form.method).toBe('POST');
      // The URL preserves all dynamic server params
      expect(form.url).toContain('DAAddr=158.69.153.134');
      expect(form.url).toContain('DAPort=7001');
      expect(form.url).toContain('TycoonId=131655160');
      expect(form.url).toContain('Action=modify');
      expect(form.hiddenFields?.Subject).toBe('');
    });

    it('handles a curriculum page with action links', () => {
      const html = `
<html><body>
  <a href="resetTycoon.asp?Tycoon=TestPlayer&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&TycoonId=&Password=test123">Reset Account</a>
  <a href="abandonRole.asp?Tycoon=TestPlayer&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&TycoonId=&Password=test123">Abandon Role</a>
  <a href="rdoSetAdvanceLevel.asp?Tycoon=TestPlayer&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&TycoonId=&Password=test123&Level=1">Upgrade</a>
</body></html>`;

      const results = extractHrefUrls(html, BASE_URL);
      expect(results).toHaveLength(3);
      expect(results.map(r => r.key)).toEqual([
        'resetTycoon.asp',
        'abandonRole.asp',
        'rdoSetAdvanceLevel.asp',
      ]);
      // All URLs preserve DAPort from ASP response
      for (const r of results) {
        expect(r.url).toContain('DAPort=7001');
        expect(r.url).toContain('DAAddr=158.69.153.134');
      }
    });

    it('handles auto-connections page with onclick handlers', () => {
      const html = `
<html><body>
<table>
  <tr>
    <td>Steel Supplier Inc.</td>
    <td><button onclick="location.href='DeleteDefaultSupplier.asp?FluidId=42&Supplier=Steel+Supplier+Inc.&Tycoon=Test&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001'">Delete</button></td>
  </tr>
  <tr>
    <td>Trade Center</td>
    <td><input type="checkbox" onchange="window.location='ModifyTradeCenterStatus.asp?Hire=true&Tycoon=Test&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001'"></td>
  </tr>
</table>
</body></html>`;

      const results = extractOnClickUrls(html, BASE_URL);
      expect(results).toHaveLength(2);
      expect(results[0].key).toBe('DeleteDefaultSupplier.asp');
      expect(results[0].url).toContain('DAPort=7001');
      expect(results[1].key).toBe('ModifyTradeCenterStatus.asp');
      expect(results[1].url).toContain('DAPort=7001');
    });

    it('handles curriculum page with script-based advance level URL', () => {
      const html = `<html><head>
<script language="JScript">
  function getBaseURL()
  {
    return (
      "http://" +
      "158.69.153.134:80" + "/" +
      "/Five/0/Visual/Voyager/NewTycoon/"
      )
  }

  function onBtnClick()
  {
    var td = getCell( event.srcElement );
    if (td != null && td.tagName == "TD")
      switch (td.command)
      {
        case "reset" :
          var URL = "resetTycoon.asp?Tycoon=SPO_test3&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&TycoonId=&Password=SIMCITY99";
          window.navigate(URL);
          break;
        case "abandon" :
          var URL = "abandonRole.asp?Tycoon=SPO_test3&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&TycoonId=&Password=SIMCITY99";
          window.navigate(URL);
          break;
      }
  }

  function onAdvanceClick()
  {
    var URL = getBaseURL() +
      "rdoSetAdvanceLevel.asp" +
      "?TycoonId=132445236" +
      "&Password=SIMCITY99" +
      "&Value=" + event.srcElement.checked +
      "&WorldName=Shamba" +
      "&DAAddr=158.69.153.134" +
      "&DAPort=7001" +
      "&Tycoon=SPO_test3";
    hiddenFrame.navigate( URL );
  }
</script>
</head><body>
  <input type="checkbox" onClick="onAdvanceClick()">Upgrade to next level
</body></html>`;

      const map = extractAllActionUrls(html, BASE_URL);
      // Should find all three action URLs from script block
      expect(map.has('resetTycoon.asp')).toBe(true);
      expect(map.has('abandonRole.asp')).toBe(true);
      expect(map.has('rdoSetAdvanceLevel.asp')).toBe(true);

      const advance = map.get('rdoSetAdvanceLevel.asp')!;
      expect(advance.url).toContain('TycoonId=132445236');
      expect(advance.url).toContain('DAPort=7001');
    });

    it('handles bank page with multiple forms', () => {
      const html = `
<form action="http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/TycoonBankAccount.asp?Action=LOAN&WorldName=Shamba&Tycoon=Test&DAAddr=158.69.153.134&DAPort=7001" method="post">
  <input type="hidden" name="LoanValue" value="">
</form>
<form action="http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/TycoonBankAccount.asp?Action=SEND&WorldName=Shamba&Tycoon=Test&DAAddr=158.69.153.134&DAPort=7001" method="post">
  <input type="hidden" name="SendDest" value="">
  <input type="hidden" name="SendValue" value="">
</form>`;

      const results = extractFormActions(html, BASE_URL);
      expect(results).toHaveLength(2);
      // Both have same filename key — use extractAllActionUrls to deduplicate, or index by action param
      expect(results[0].key).toBe('TycoonBankAccount.asp');
      expect(results[0].url).toContain('Action=LOAN');
      expect(results[1].url).toContain('Action=SEND');
    });
  });

  // ===== extractMapCoords =====
  describe('extractMapCoords', () => {
    it('reads x/y off an absolute URL', () => {
      expect(extractMapCoords('http://158.69.153.134/Five/0/x.asp?x=706&y=436')).toEqual({ x: 706, y: 436 });
    });

    it('reads x/y off a relative URL', () => {
      expect(extractMapCoords('/Five/0/Visual/Voyager/NewFacility/MsgFacility.asp?x=706&y=436')).toEqual({ x: 706, y: 436 });
    });

    it('returns null when there is no query string', () => {
      expect(extractMapCoords('/Five/0/x.asp')).toBeNull();
    });

    it('returns null when only x is present', () => {
      expect(extractMapCoords('/x.asp?x=706')).toBeNull();
    });

    it('returns null for a non-numeric value', () => {
      expect(extractMapCoords('/x.asp?x=abc&y=436')).toBeNull();
    });

    it('returns null for a negative value', () => {
      expect(extractMapCoords('/x.asp?x=-5&y=436')).toBeNull();
    });

    it('reads x/y even with extra params around them', () => {
      expect(extractMapCoords('/x.asp?a=1&x=706&b=2&y=436&c=3')).toEqual({ x: 706, y: 436 });
    });

    it('returns null for an empty string', () => {
      expect(extractMapCoords('')).toBeNull();
    });
  });
});
