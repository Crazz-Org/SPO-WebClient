import { DEFAULT_LANGUAGE_ID, LANGUAGES, normalizeLanguageId, withLangId } from './language';

describe('LANGUAGES', () => {
  it('names the six ASP instances Five/0..Five/5', () => {
    expect(LANGUAGES.map((l) => l.id)).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(LANGUAGES.map((l) => l.label)).toEqual([
      'English', 'Español', 'Français', 'Deutsch', 'Italiano', 'Português',
    ]);
  });

  it('defaults to English, the id Voyager starts from (ClientMLS.pas:6)', () => {
    expect(DEFAULT_LANGUAGE_ID).toBe('0');
  });
});

describe('normalizeLanguageId', () => {
  it('lets every catalogued id through unchanged', () => {
    for (const { id } of LANGUAGES) {
      expect(normalizeLanguageId(id)).toBe(id);
    }
  });

  it.each([
    ['an id outside the catalogue', '9'],
    ['an id with trailing space', '0 '],
    ['the empty string', ''],
    ['a number', 2],
    ['undefined', undefined],
    ['null', null],
    ['an object', { id: '1' }],
  ])('falls back to the default for %s', (_label, raw) => {
    expect(normalizeLanguageId(raw)).toBe('0');
  });
});

describe('withLangId', () => {
  // HTMLHandler.pas:141-143 — `?` when the URL carries no query, `&` otherwise.
  it('opens the query with ? when the URL has none', () => {
    expect(withLangId('http://host/Five/0/a.asp', '3')).toBe('http://host/Five/0/a.asp?LangId=3');
  });

  it('appends with & when the URL already carries a query', () => {
    expect(withLangId('http://host/a.asp?X=1', '2')).toBe('http://host/a.asp?X=1&LangId=2');
  });

  it('appends after a trailing empty parameter, which is still a query', () => {
    expect(withLangId('http://host/a.asp?RIWS=', '0')).toBe('http://host/a.asp?RIWS=&LangId=0');
  });

  // Cached form-action URLs are re-fetched through the same boundary.
  it('leaves a URL that already carries a LangId untouched', () => {
    const url = 'http://host/a.asp?X=1&LangId=4';
    expect(withLangId(url, '2')).toBe(url);
  });

  it('is idempotent under a second wrap', () => {
    const once = withLangId('http://host/a.asp', '5');
    expect(withLangId(once, '5')).toBe(once);
  });

  it('encodes the id rather than pasting it into the query raw', () => {
    expect(withLangId('http://host/a.asp', 'a&b')).toBe('http://host/a.asp?LangId=a%26b');
  });
});
