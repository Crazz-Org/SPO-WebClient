/**
 * The original chat's player icons — `cache/ChatIcons/ChatList.dat` as
 * `ChatListHandlerViewer.pas` reads it (DecodeCodeMSGChat :104-215, AddUser :219-300).
 *
 * [mask]: each modifier bit has an icon, unless a bit still unread when it is reached
 * cancels it (the third column). The bits are taken lowest first, each cleared before
 * its cancel list is checked — exactly as the loop does.
 * [Nobility]: the highest rank whose threshold the points reach gives the crown, and
 * in the user list a rule above the row and the rank's name plate under it.
 */

interface MaskIcon {
  mask: number;
  icon: string;
  cancelledBy: number;
}

const MASK_ICONS: MaskIcon[] = [
  { mask: 0x01, icon: 'support', cancelledBy: 0 },
  { mask: 0x02, icon: 'oc', cancelledBy: 0x10 },
  { mask: 0x04, icon: 'publisher', cancelledBy: 0x10 },
  { mask: 0x08, icon: 'ambassador', cancelledBy: 0x80 },
  { mask: 0x10, icon: 'gm', cancelledBy: 0x100 },
  { mask: 0x20, icon: 'trial', cancelledBy: 0x100 },
  { mask: 0x40, icon: 'newbie', cancelledBy: 0x100 },
  { mask: 0x80, icon: 'veteran', cancelledBy: 0x100 },
  { mask: 0x100, icon: 'ifel', cancelledBy: 0 },
];

const NOBILITY: { points: number; rank: string }[] = [
  { points: 500, rank: 'baron' },
  { points: 1000, rank: 'viscount' },
  { points: 2000, rank: 'earl' },
  { points: 4000, rank: 'marquess' },
  { points: 8000, rank: 'duke' },
  { points: 16000, rank: 'srduke' },
];

/** The rank a player's nobility points reach, or null below the first. */
export function nobilityRank(points: number): string | null {
  let rank: string | null = null;
  for (const n of NOBILITY) if (points >= n.points) rank = n.rank;
  return rank;
}

/** The icons shown before a player's name: role icons, then the nobility crown. */
export function chatUserIcons(modifiers: number, nobilityPoints: number): string[] {
  const icons: string[] = [];
  let remaining = modifiers;
  for (const m of MASK_ICONS) {
    if (remaining === 0) break;
    if ((remaining & m.mask) === 0) continue;
    remaining &= ~m.mask;
    if (m.cancelledBy && (remaining & m.cancelledBy)) continue;
    icons.push(m.icon);
  }
  const rank = nobilityRank(nobilityPoints);
  if (rank) icons.push(rank);
  return icons;
}
