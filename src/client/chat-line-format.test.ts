import { CHAT_EMOTICONS, substituteEmoticons, CHAT_ROLE_PRIORITY, roleClassKeyFor } from './chat-line-format';
import { CHAT_MODIFIER_FLAGS } from '../shared/types/domain-types';

describe('substituteEmoticons', () => {
  it('substitutes every token in the table', () => {
    for (const [token, glyph] of CHAT_EMOTICONS) {
      expect(substituteEmoticons(`hi ${token} there`)).toBe(`hi ${glyph} there`);
    }
  });

  it('does not let :) eat the dash form :-)', () => {
    expect(substituteEmoticons(':-)')).toBe('\u{1F642}');
  });

  it('returns a body with no token unchanged', () => {
    expect(substituteEmoticons('no tokens here')).toBe('no tokens here');
  });

  it('returns the empty string unchanged', () => {
    expect(substituteEmoticons('')).toBe('');
  });

  it('substitutes more than one occurrence in one pass', () => {
    expect(substituteEmoticons(':) :(')).toBe('\u{1F642} \u{1F641}');
  });
});

describe('roleClassKeyFor', () => {
  it('returns null for undefined', () => {
    expect(roleClassKeyFor(undefined)).toBeNull();
  });

  it('returns null for 0', () => {
    expect(roleClassKeyFor(0)).toBeNull();
  });

  it('returns null for Trial alone', () => {
    expect(roleClassKeyFor(CHAT_MODIFIER_FLAGS.TRIAL)).toBeNull();
  });

  it('returns null for Newbie alone', () => {
    expect(roleClassKeyFor(CHAT_MODIFIER_FLAGS.NEWBIE)).toBeNull();
  });

  it('maps each of the six role classes', () => {
    for (const { flag, classKey } of CHAT_ROLE_PRIORITY) {
      expect(roleClassKeyFor(flag)).toBe(classKey);
    }
  });

  it('first-match-wins when two modifier bits are set', () => {
    const bothSet = CHAT_MODIFIER_FLAGS.VETERAN | CHAT_MODIFIER_FLAGS.GAME_MASTER;
    expect(roleClassKeyFor(bothSet)).toBe('roleGameMaster');
  });
});
