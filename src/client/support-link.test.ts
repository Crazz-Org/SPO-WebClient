import { describe, it, expect } from '@jest/globals';
import { buildSupportUrl, getSupportUrl, DEFAULT_SUPPORT_URL } from './support-link';

describe('buildSupportUrl', () => {
  it('appends WorldName and UserName, percent-encoded', () => {
    const url = buildSupportUrl('https://support.example.org/support.asp', 'Free Space', 'a b');
    expect(url).toBe('https://support.example.org/support.asp?WorldName=Free+Space&UserName=a+b');
  });

  it('preserves an existing query string on the base', () => {
    const url = buildSupportUrl('https://support.example.org/support.asp?InGame=YES', 'planitia', 'Crazz');
    expect(url).toBe('https://support.example.org/support.asp?InGame=YES&WorldName=planitia&UserName=Crazz');
  });

  it('omits WorldName when it is empty', () => {
    const url = buildSupportUrl('https://support.example.org/support.asp', '', 'Crazz');
    expect(url).toBe('https://support.example.org/support.asp?UserName=Crazz');
  });

  it('omits UserName when it is empty', () => {
    const url = buildSupportUrl('https://support.example.org/support.asp', 'planitia', '');
    expect(url).toBe('https://support.example.org/support.asp?WorldName=planitia');
  });

  it('returns the base unchanged when it cannot be parsed as a URL', () => {
    expect(buildSupportUrl('https://', 'planitia', 'Crazz')).toBe('https://');
  });
});

describe('getSupportUrl', () => {
  it('returns the default in a non-browser environment', () => {
    expect(typeof window).toBe('undefined');
    expect(getSupportUrl()).toBe(DEFAULT_SUPPORT_URL);
  });
});
