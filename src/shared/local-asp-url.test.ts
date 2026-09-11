import { parseLocalAspUrl } from './local-asp-url';

describe('parseLocalAspUrl', () => {
  it('extracts x/y from the real MsgZoned anchor form', () => {
    expect(parseLocalAspUrl('http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=220&y=41')).toEqual({
      x: 220,
      y: 41,
    });
  });

  it('accepts https and case-insensitive host/frame_Id/frame_Action', () => {
    expect(parseLocalAspUrl('https://LOCAL.ASP?frame_Id=mapisoview&frame_Action=select&x=1&y=2')).toEqual({
      x: 1,
      y: 2,
    });
  });

  it('returns null for a different frame_Id', () => {
    expect(parseLocalAspUrl('http://local.asp?frame_Id=MailView&frame_Action=SELECT&x=1&y=2')).toBeNull();
  });

  it('returns null for a different frame_Action', () => {
    expect(parseLocalAspUrl('http://local.asp?frame_Id=MapIsoView&frame_Action=MoveTo&x=1&y=2')).toBeNull();
  });

  it('returns null for a missing x', () => {
    expect(parseLocalAspUrl('http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&y=2')).toBeNull();
  });

  it('returns null for a non-numeric x', () => {
    expect(parseLocalAspUrl('http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=abc&y=2')).toBeNull();
  });

  it('returns null for a negative x', () => {
    expect(parseLocalAspUrl('http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=-1&y=2')).toBeNull();
  });

  it('returns null for a wrong host', () => {
    expect(
      parseLocalAspUrl('http://example.com/?frame_Id=MapIsoView&frame_Action=SELECT&x=1&y=2'),
    ).toBeNull();
  });

  it.each(['not a url', '', 'http://'])('returns null without throwing for %p', input => {
    expect(parseLocalAspUrl(input)).toBeNull();
  });
});
