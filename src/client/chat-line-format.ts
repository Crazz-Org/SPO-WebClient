/**
 * Chat line formatting — emoticon substitution and the role-colour rule.
 *
 * Ports two behaviours from the legacy Voyager client whose data files
 * (`ChatIcons\ChatList.dat`, `ChatIcons\smileys.dat`) no longer exist: the
 * schema and the algorithm survive, the table is redesigned here.
 */

import { CHAT_MODIFIER_FLAGS } from '../shared/types/domain-types';

/**
 * Text emoticon -> glyph. Longest token first: the alternation is built in
 * this order so `:-)` is never eaten by `:)`. Case-sensitive, like the
 * legacy `pos()`.
 */
export const CHAT_EMOTICONS: ReadonlyArray<readonly [string, string]> = [
  [':-)', '\u{1F642}'], [':)', '\u{1F642}'],
  [':-(', '\u{1F641}'], [':(', '\u{1F641}'],
  [';-)', '\u{1F609}'], [';)', '\u{1F609}'],
  [':-D', '\u{1F600}'], [':D', '\u{1F600}'],
  [':-P', '\u{1F61B}'], [':P', '\u{1F61B}'],
  [":'(", '\u{1F622}'], ['<3', '\u{2764}\u{FE0F}'],
];

function escapeRegExp(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EMOTICON_PATTERN = new RegExp(
  CHAT_EMOTICONS.map(([token]) => escapeRegExp(token)).join('|'),
  'g',
);

const EMOTICON_MAP = new Map(CHAT_EMOTICONS);

/** Substitutes every recognized text emoticon with its glyph, one pass. */
export function substituteEmoticons(text: string): string {
  return text.replace(EMOTICON_PATTERN, (token) => EMOTICON_MAP.get(token) ?? token);
}

/**
 * Modifier -> the CSS-module class key that colours the message body.
 * Highest priority first; the first match wins (`ChatListHandlerViewer.pas:156-179`,
 * where the file order that used to decide this is now explicit here).
 */
export const CHAT_ROLE_PRIORITY: ReadonlyArray<{ flag: number; classKey: string }> = [
  { flag: CHAT_MODIFIER_FLAGS.GAME_MASTER, classKey: 'roleGameMaster' },
  { flag: CHAT_MODIFIER_FLAGS.DEVELOPER, classKey: 'roleDeveloper' },
  { flag: CHAT_MODIFIER_FLAGS.SUPPORT, classKey: 'roleSupport' },
  { flag: CHAT_MODIFIER_FLAGS.PUBLISHER, classKey: 'rolePublisher' },
  { flag: CHAT_MODIFIER_FLAGS.AMBASSADOR, classKey: 'roleAmbassador' },
  { flag: CHAT_MODIFIER_FLAGS.VETERAN, classKey: 'roleVeteran' },
];

/** The class key for the highest-priority modifier set, or `null` for none/Trial/Newbie. */
export function roleClassKeyFor(modifiers: number | undefined): string | null {
  if (!modifiers) return null;
  for (const { flag, classKey } of CHAT_ROLE_PRIORITY) {
    if (modifiers & flag) return classKey;
  }
  return null;
}
