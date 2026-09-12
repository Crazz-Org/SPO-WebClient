/**
 * RatingsRail — the four left sub-tabs of the Politics page (`ratingtabs.asp`).
 *
 *   POPULAR RATING   read-only  (`popularratings.asp`)
 *   TYCOONS' RATINGS ratable    (`tycoonratings.asp` -> RDOSetRatingFrom)
 *   IFEL's RATING    read-only  (`ifelratings.asp`)
 *   PUBLICITY        ruler only (`mayorpub.asp` -> RDOSetPublicity)
 *
 * `ratingtabs.asp:76`/`:122` hide all but IFEL when the seat is vacant
 * (`if Obj.HasRuler`) — there is nobody to rate and nobody buying publicity.
 *
 * ## Nobody rates themselves
 *
 * `RDOSetRatingFrom` drops the whole call when the sender resolves to the
 * incumbent:
 *
 *     if (Tycoon <> nil) and (Tycoon.MasterRole <> PoliticalTown.Mayor.MasterRole)
 *
 * `Kernel/TownPolitics.pas:195`. Silently — it is a `procedure`, so nothing
 * comes back, and the surrounding `try/except` swallows the rest. `MasterRole`
 * climbs to the role holder (`Kernel/Kernel.pas:10960-10965`), so playing the
 * mayor's own role company does not get around it either: both identities
 * resolve to the same tycoon.
 *
 * The UI must therefore prevent the gesture rather than report a failure —
 * there is no failure to report. `isRuler` is the gate, and the gateway is what
 * decides it: `data.isRuler`, computed once by `holdsOffice`
 * (politics-handler.ts) from BOTH identities the session holds. This rail used
 * to answer the question itself, comparing the ruler's name against the single
 * login name the browser keeps. That comparison happened to be right, but it
 * was a second, weaker copy of a two-pronged test — right by luck rather than
 * by construction, and invisible to anyone auditing the civic surface (OB-31).
 *
 * Verified live 2026-08-20: `Setting town politics Tycoon rating: SPO_test3,
 * College, 90` on the Helartia Town Hall, of which SPO_test3 is mayor. The
 * model server logged the entry and changed nothing.
 *
 * ### What the reference page does, and what it was meant to do
 *
 * `tycoonratings.asp` wrote the same gate and then switched it off:
 *
 *     'IsMayor = (Ucase(TycoonName) = Ucase(Obj.ActualRuler)) or ...   ' :24
 *     IsMayor = true                                                   ' :25
 *     var canModify = <% if not IsMayor then %>true<% ... %>            ' :53
 *
 * `canModify` guards `onRowMouseClick` (`:76`), and that handler is the only
 * thing that un-hides the `<select>` — the control ships inside a
 * `display: none` div (`:149-151`). So the INTENT is exactly what this rail now
 * does: no rating control for the office holder. The shipped page goes further
 * by accident — with `IsMayor` forced true, the inline control is unreachable
 * for *everyone*, and the footer sends all readers to the newspaper forum
 * (`StrTycoonRatings_3`, `ePolitics.lng:52`).
 *
 * We implement the intent and keep the control for everyone else, which the
 * server accepts. The one thing not copied is the mayor's footer text: Voyager
 * points them at the newspaper, but that path reaches the same guarded
 * `RDOSetRatingFrom`, so it would be advice that cannot work.
 */

import { useCallback } from 'react';
import type { PoliticsData, PoliticsRatingEntry } from '@/shared/types';
import { usePoliticsStore, type RatingRail } from '../../store/politics-store';
import { useClient } from '../../context';
import { ProgressBar } from '../common';
import styles from './PoliticsPanel.module.css';

interface RatingsRailProps {
  data: PoliticsData;
}

const RAIL_LABELS: Record<RatingRail, string> = {
  popular: 'Popular',
  tycoons: "Tycoons'",
  ifel: "IFEL's",
  publicity: 'Publicity',
};

/**
 * The eleven values Voyager's own rating form offers — 0 to 100 by 10
 * (`boardmsg.asp:339-349`, above a `<option value="-">` placeholder at `:338`).
 * The in-page dropdown of `tycoonratings.asp:154-158` offers only five, and is
 * unreachable anyway (see the module note); the wider range is the one the
 * server has always accepted.
 */
export const RATING_CHOICES = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];

/** `mayorpub.asp:182-186` — five levels, labels from `ePolitics.lng:7-11`. */
const PUBLICITY_CHOICES: Array<{ value: number; label: string }> = [
  { value: 100, label: 'Highest' },
  { value: 75, label: 'High' },
  { value: 50, label: 'Normal' },
  { value: 25, label: 'Low' },
  { value: 0, label: 'Lowest' },
];

function ReadOnlyRatings({ rows }: { rows: PoliticsRatingEntry[] }) {
  if (rows.length === 0) {
    return <div className={styles.politicsEmptyRail}>No ratings published for this office.</div>;
  }
  return (
    <div className={styles.ratings}>
      {rows.map((rating) => (
        <div key={rating.name} className={styles.ratingRow}>
          <span className={styles.ratingName}>{rating.name}</span>
          <ProgressBar
            value={rating.value / 100}
            variant={rating.value >= 50 ? 'success' : 'warning'}
            showLabel
          />
        </div>
      ))}
    </div>
  );
}

export function RatingsRail({ data }: RatingsRailProps) {
  const client = useClient();
  const activeRail = usePoliticsStore((s) => s.activeRatingRail);
  const setActiveRail = usePoliticsStore((s) => s.setActiveRatingRail);
  const pendingRatings = usePoliticsStore((s) => s.pendingRatings);
  const pendingPublicity = usePoliticsStore((s) => s.pendingPublicity);

  const isRuler = data.isRuler;

  const handleRate = useCallback((ratingId: string, value: string) => {
    client.onSetPoliticsRating(ratingId, parseInt(value, 10));
  }, [client]);

  const handlePublicity = useCallback((ratingId: string, value: string) => {
    client.onSetPoliticsPublicity(ratingId, parseInt(value, 10));
  }, [client]);

  // `ratingtabs.asp:75` / `:118` — the two ruler-dependent rails.
  const rails: RatingRail[] = data.hasRuler
    ? ['popular', 'tycoons', 'ifel', 'publicity']
    : ['ifel'];
  const rail = rails.includes(activeRail) ? activeRail : rails[0];

  return (
    <>
      <div className={styles.railBar} role="tablist" aria-label="Ratings">
        {rails.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={rail === id}
            className={rail === id ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
            onClick={() => setActiveRail(id)}
          >
            {RAIL_LABELS[id]}
          </button>
        ))}
      </div>

      <div className={styles.railBody}>
        {rail === 'popular' && <ReadOnlyRatings rows={data.popularRatings} />}
        {rail === 'ifel' && <ReadOnlyRatings rows={data.ifelRatings} />}

        {rail === 'tycoons' && (
          data.tycoonsRatings.length === 0 ? (
            <div className={styles.politicsEmptyRail}>No ratings published for this office.</div>
          ) : (
            <>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Criterion</th>
                    <th>Rating</th>
                    <th>Your opinion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tycoonsRatings.map((rating) => {
                    const sent = rating.id ? pendingRatings.get(rating.id) : undefined;
                    return (
                      <tr key={rating.name}>
                        <td>{rating.name}</td>
                        <td className={sent === undefined ? undefined : styles.ratingSuperseded}>
                          {rating.value}%
                        </td>
                        <td>
                          {/* Two rows carry no control. A row with no cache id
                              has no RatingId to send back; and the office holder
                              cannot rate their own term at all — see isRuler. */}
                          {isRuler || rating.id === undefined ? (
                            <span className={styles.ratingUnavailable}>—</span>
                          ) : (
                            <select
                              className={styles.ratingSelect}
                              aria-label={`Your rating for ${rating.name}`}
                              value={sent ?? ''}
                              onChange={(e) => handleRate(rating.id!, e.target.value)}
                            >
                              <option value="" disabled>Rate…</option>
                              {RATING_CHOICES.map((v) => (
                                <option key={v} value={v}>{v}%</option>
                              ))}
                            </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {isRuler ? (
                <p className={styles.railNote}>
                  You cannot rate your own term in office. These are the other
                  tycoons&apos; opinions of it.
                </p>
              ) : (
                /* StrTycoonRatings_1 — ePolitics.lng:50. The sent value is not the
                   new rating: the server mixes it with everyone else's, weighted
                   by prestige, and the figure above only moves at the next cache. */
                <p className={styles.railNote}>
                  Values you send are marked. They are mixed with those sent by other
                  tycoons, weighted by personal prestige, and take effect at the next
                  survey — the rating shown does not change immediately.
                </p>
              )}
            </>
          )
        )}

        {rail === 'publicity' && (
          <>
            {data.publicityAds && <p className={styles.railLead}>{data.publicityAds}</p>}
            {data.publicity.length === 0 ? (
              <div className={styles.politicsEmptyRail}>No publicity criteria published.</div>
            ) : (
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Criterion</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {data.publicity.map((row) => {
                    const level = pendingPublicity.get(row.id) ?? row.level;
                    return (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>
                          {/* `mayorpub.asp:50` — only the office holder may move
                              these, and `rdoModifyPub.asp:14` re-checks it. */}
                          {isRuler ? (
                            <select
                              className={styles.ratingSelect}
                              aria-label={`Publicity priority for ${row.name}`}
                              value={level}
                              onChange={(e) => handlePublicity(row.id, e.target.value)}
                            >
                              {PUBLICITY_CHOICES.map((c) => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </select>
                          ) : (
                            PUBLICITY_CHOICES.find((c) => c.value === level)?.label ?? '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {isRuler && (
              /* StrMayorPub_3 / StrMayorPub_1 — ePolitics.lng:5,3 */
              <p className={styles.railNote}>
                Change the priorities to distribute your publicity time. Configure
                the providers themselves on the Town Hall&apos;s Advertisement settings.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
