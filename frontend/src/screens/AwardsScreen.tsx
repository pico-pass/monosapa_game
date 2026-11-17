import { useCallback, useEffect, useState } from 'react';
import { titlePerkText, trophyTitleText } from '../game/achievements';
import { AWARD_CATEGORIES, type AwardCategory } from '../game/balance';
import { AWARD_TEXT, AWARD_UI_TEXT, awardValueText } from '../game/content';
import { api, errorText } from '../platform/api';
import { readSeen, writeSeen, type AwardItem, type AwardRow, type AwardsData, type Seen, type VoteCategory } from '../platform/awards';
import { useAuth } from '../store/authStore';
import { doClaimAwards, doSetTitle, syncTrophies, toast, useUi } from '../store/gameStore';
import { refreshSummary } from '../store/socialStore';

const REFRESH_MS = 60_000;
const DAY = 24 * 3600_000;

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** 시상식: 집계 중 → 투표 → 결과 발표(레드카펫) → 보상. 일정·순위·보상은 서버가 정한다. */
export function AwardsScreen() {
  const { game: g } = useUi();
  const uid = useAuth().user?.id ?? 'guest';
  const [data, setData] = useState<AwardsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<Seen>({});

  const load = useCallback(async () => {
    try {
      setData(await api<AwardsData>('awards'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const period = data?.period ?? null;
  useEffect(() => {
    if (period) setSeen(readSeen(storage(), uid, period));
  }, [uid, period]);

  // 서버가 받았다고 기록한 트로피가 이 저장에 없으면(받는 중에 끊겼을 때) 다시 채운다
  useEffect(() => {
    if (data && data.trophies.some((t) => !g.trophies.includes(t))) syncTrophies(data.trophies);
  }, [data, g.trophies]);

  const vote = async (category: VoteCategory, key: string) => {
    setBusy(true);
    try {
      await api('awards/vote', { method: 'POST', body: { category, key } });
      toast('🗳️ 투표했어요. 발표를 기다려 주세요!', 'good');
      await Promise.all([load(), refreshSummary()]);
    } catch (e) {
      toast(errorText(e), 'warn');
    }
    setBusy(false);
  };
  const claim = async () => {
    setBusy(true);
    await doClaimAwards();
    await Promise.all([load(), refreshSummary()]);
    setBusy(false);
  };
  const onSeen = (next: Seen) => {
    setSeen(next);
    if (period) writeSeen(storage(), uid, period, next);
  };

  return (
    <section className="screen" aria-label="시상식">
      <h2 className="section-title">🏆 {AWARD_UI_TEXT.title}</h2>
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted">불러오는 중…</p>}
      {data && <AwardsView data={data} trophies={g.trophies} title={g.cosmetics.title} seen={seen} busy={busy} onVote={vote} onClaim={claim} onSeen={onSeen} onTitle={doSetTitle} />}
    </section>
  );
}

export interface AwardsViewProps {
  data: AwardsData;
  /** 내 트로피(게임 저장) */
  trophies: readonly string[];
  /** 달고 있는 칭호 ID */
  title: string | null;
  seen: Seen;
  busy: boolean;
  onVote: (category: VoteCategory, key: string) => void;
  onClaim: () => void;
  onSeen: (next: Seen) => void;
  onTitle: (id: string | null) => void;
}

/** 남은 시간 문구: 하루 이상이면 일, 아니면 시간 */
export function leftText(ms: number): string {
  const left = Math.max(0, ms);
  return left >= DAY ? `${Math.ceil(left / DAY)}일` : `${Math.max(1, Math.ceil(left / 3600_000))}시간`;
}

function phaseLine(d: AwardsData): { chip: string; text: string } {
  if (d.phase === 'collecting') return { chip: AWARD_UI_TEXT.collecting, text: `투표까지 ${leftText(d.voteFrom - d.now)} 남았어요.` };
  if (d.phase === 'voting') return { chip: AWARD_UI_TEXT.voting, text: `결과 발표까지 ${leftText(d.announceAt - d.now)} 남았어요.` };
  if (d.phase === 'announced') return { chip: AWARD_UI_TEXT.announced, text: `보상은 ${leftText(d.claimUntil - d.now)} 안에 받아 주세요.` };
  return { chip: AWARD_UI_TEXT.closed, text: '보상 기간이 끝났어요. 결과는 계속 볼 수 있어요.' };
}

function Row({ row, category }: { row: AwardRow; category: AwardCategory }) {
  return (
    <li className={`aw-row${row.mine ? ' aw-mine' : ''}`} value={row.rank}>
      <span className={`aw-rank${row.rank <= 3 ? ' aw-top' : ''}`}>{row.rank}</span>
      <div className="aw-main">
        <strong>{row.title}</strong>
        <small className="muted">
          {row.artist}
          {row.mine && ' · 내 곡'}
        </small>
      </div>
      <span className="aw-value">{awardValueText(category, row.value)}</span>
    </li>
  );
}

function Standings({ data }: { data: AwardsData }) {
  if (!data.standings) return null;
  return (
    <>
      <h3 className="aw-sub">지금까지의 순위</h3>
      <p className="fineprint">{AWARD_UI_TEXT.scoreNote}</p>
      {data.standings.map((st) => {
        const t = AWARD_TEXT[st.category];
        return (
          <div key={st.category} className="card aw-cat">
            <strong>
              {t.icon} {t.name}
            </strong>
            <small className="muted">{t.desc}</small>
            {st.top.length === 0 ? (
              <p className="empty">아직 집계된 곡이 없어요.</p>
            ) : (
              <ol className="aw-list" aria-label={`${t.name} 중간 순위`}>
                {st.top.map((r) => (
                  <Row key={r.rank} row={r} category={st.category} />
                ))}
              </ol>
            )}
            {st.mine && (
              <ol className="aw-list aw-list-mine" aria-label="내 순위">
                <Row row={st.mine} category={st.category} />
              </ol>
            )}
          </div>
        );
      })}
    </>
  );
}

function Ballots({ data, busy, onVote }: { data: AwardsData; busy: boolean; onVote: AwardsViewProps['onVote'] }) {
  const [pending, setPending] = useState<string | null>(null);
  if (!data.ballot) return null;
  return (
    <>
      <h3 className="aw-sub">🗳️ 팬 투표상 — 투표하세요</h3>
      <p className="fineprint">부문마다 한 표이고 투표한 뒤에는 바꿀 수 없어요. 내 곡에는 투표할 수 없고, 투표에 참여하면 부문마다 💎 2를 받아요. 후보는 12월 23일까지의 점수 상위 10곡이에요.</p>
      {data.voteBlocked && (
        <p className="muted" role="note">
          {data.voteBlocked}
        </p>
      )}
      {data.ballot.map((b) => {
        const t = AWARD_TEXT[b.category];
        return (
          <div key={b.category} className="card aw-cat">
            <strong>
              {t.icon} {t.name}
            </strong>
            {b.votedKey !== null && <small className="aw-voted">✔ 투표했어요</small>}
            {b.candidates.length === 0 && <p className="empty">아직 후보가 없어요.</p>}
            <ol className="aw-list" aria-label={`${t.name} 후보`}>
              {b.candidates.map((c, i) => {
                const mineVote = b.votedKey === c.key;
                const id = `${b.category}|${c.key}`;
                return (
                  <li key={c.key} className={`aw-row${c.mine ? ' aw-mine' : ''}${mineVote ? ' aw-picked' : ''}`} value={i + 1}>
                    <span className="aw-rank">{i + 1}</span>
                    <div className="aw-main">
                      <strong>{c.title}</strong>
                      <small className="muted">
                        {c.artist}
                        {c.mine && ' · 내 곡'}
                      </small>
                    </div>
                    {mineVote ? (
                      <span className="aw-value">✔ 내 표</span>
                    ) : c.mine || b.votedKey !== null || !data.canVote ? null : pending === id ? (
                      <span className="aw-confirm">
                        <button
                          type="button"
                          className="btn btn-accent"
                          disabled={busy}
                          onClick={() => {
                            setPending(null);
                            onVote(b.category, c.key);
                          }}
                        >
                          확정
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>
                          취소
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPending(id)}>
                        투표
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </>
  );
}

const itemLabel = (it: AwardItem): string => (it.kind === 'win' ? `${AWARD_TEXT[it.category].icon} ${AWARD_TEXT[it.category].name} ${it.rank}위` : `🗳️ ${AWARD_TEXT[it.category].name} 투표 참여`);

function ClaimPanel({ data, busy, onClaim }: { data: AwardsData; busy: boolean; onClaim: () => void }) {
  if (data.items.length === 0) return null;
  const open = data.items.filter((i) => !i.claimed);
  const sum = open.reduce((n, i) => n + i.diamonds, 0);
  return (
    <div className="card aw-claim">
      <strong>🎁 내 시상식 보상</strong>
      <ul className="aw-items">
        {data.items.map((it) => (
          <li key={it.id}>
            <span>
              {itemLabel(it)}
              {it.trophy && ' · 🏆 트로피'}
            </span>
            <small className={it.claimed ? 'muted' : 'aw-gem'}>{it.claimed ? '받음' : `💎 ${it.diamonds}`}</small>
          </li>
        ))}
      </ul>
      {data.canClaim ? (
        <button type="button" className="btn btn-accent btn-wide" disabled={busy} onClick={onClaim}>
          🎁 모두 받기 💎 {sum}
        </button>
      ) : open.length === 0 ? (
        <small className="muted">보상을 모두 받았어요.</small>
      ) : (
        <small className="muted">보상을 받을 수 있는 기간이 지났어요.</small>
      )}
    </div>
  );
}

/** 한 부문의 발표: 밑자리부터 한 자리씩 공개한다(3위 → 2위 → 1위). 본 만큼은 기억해서 다시 오면 바로 보인다. */
function Carpet({ category, rows, seen, onSeen }: { category: AwardCategory; rows: AwardRow[]; seen: Seen; onSeen: (next: Seen) => void }) {
  const t = AWARD_TEXT[category];
  const n = rows.length;
  const shown = Math.min(n, seen[category] ?? 0);
  const next = n - shown; // 다음에 공개할 순위
  const mineWon = rows.some((r, i) => r.mine && i >= n - shown);
  return (
    <div className="card aw-cat">
      <strong>
        {t.icon} {t.name}
      </strong>
      <small className="muted">{t.desc}</small>
      {n === 0 ? (
        <p className="empty">{category.startsWith('fan-') ? '투표가 없어서 수상곡이 없어요.' : '수상곡이 없어요.'}</p>
      ) : (
        <>
          <ol className="aw-list" aria-label={`${t.name} 결과`}>
            {rows.map((r, i) =>
              i >= n - shown ? (
                <li key={r.rank} className={`aw-row aw-win${r.mine ? ' aw-mine' : ''}`} value={r.rank}>
                  <span className={`aw-rank${r.rank <= 3 ? ' aw-top' : ''}`}>{r.rank}</span>
                  <div className="aw-main">
                    <strong>{r.title}</strong>
                    <small className="muted">
                      {r.artist}
                      {r.mine && ' · 내 곡'}
                    </small>
                  </div>
                  <span className="aw-value">
                    {awardValueText(category, r.value)}
                    {r.reward > 0 && <small className="aw-gem"> 💎{r.reward}</small>}
                  </span>
                </li>
              ) : (
                <li key={r.rank} className="aw-row aw-hidden" value={r.rank}>
                  <span className="aw-rank">{r.rank}</span>
                  <div className="aw-main">
                    <strong>❔ 발표 전</strong>
                  </div>
                </li>
              ),
            )}
          </ol>
          {next > 0 ? (
            <button type="button" className="btn btn-ghost btn-wide" onClick={() => onSeen({ ...seen, [category]: shown + 1 })}>
              🎬 {next}위 발표 보기
            </button>
          ) : (
            mineWon && <p className="aw-cheer">🎉 축하해요! 내 곡이 {t.name}에 이름을 올렸어요.</p>
          )}
        </>
      )}
    </div>
  );
}

function Results({ data, seen, onSeen }: { data: AwardsData; seen: Seen; onSeen: (next: Seen) => void }) {
  if (!data.results) return null;
  const all = data.results;
  const pending = all.some((r) => (seen[r.category] ?? 0) < r.rows.length);
  return (
    <>
      <h3 className="aw-sub">🎬 {data.period} 시상식 결과</h3>
      {pending && (
        <button
          type="button"
          className="btn btn-ghost btn-wide"
          onClick={() => {
            const next: Seen = { ...seen };
            for (const r of all) next[r.category] = r.rows.length;
            onSeen(next);
          }}
        >
          ⏭ 전부 공개
        </button>
      )}
      {AWARD_CATEGORIES.map((c) => {
        const r = all.find((x) => x.category === c);
        return r ? <Carpet key={c} category={c} rows={r.rows} seen={seen} onSeen={onSeen} /> : null;
      })}
    </>
  );
}

function Trophies({ trophies, title, onTitle }: { trophies: readonly string[]; title: string | null; onTitle: (id: string | null) => void }) {
  const list = trophies.map((id) => ({ id, text: trophyTitleText(id) })).filter((t): t is { id: string; text: string } => t.text !== null);
  if (list.length === 0) return null;
  return (
    <div className="card aw-trophies">
      <strong>🏆 내 트로피</strong>
      <small className="muted">1위 트로피는 칭호로 달 수 있고, 달면 효과가 붙고 챗방에도 보여요.</small>
      <div className="pf-titles" role="group" aria-label="트로피 칭호">
        {list.map((t) => (
          <button key={t.id} type="button" className="pf-title" aria-pressed={title === t.id} onClick={() => onTitle(title === t.id ? null : t.id)}>
            「{t.text}」 {titlePerkText(t.id) && <small className="muted">{titlePerkText(t.id)}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 단계에 맞는 시상식 화면(서버가 준 값을 보여 주기만 하는 순수 화면이라 테스트에서 값을 바꿔 가며 그린다). */
export function AwardsView({ data, trophies, title, seen, busy, onVote, onClaim, onSeen, onTitle }: AwardsViewProps) {
  const line = phaseLine(data);
  return (
    <>
      <p className="muted">{AWARD_UI_TEXT.intro}</p>
      <div className="card aw-phase">
        <span className={`aw-chip aw-chip-${data.phase}`}>{line.chip}</span>
        <strong>{data.period} 시상식</strong>
        <small className="muted">{line.text}</small>
        <small className="fineprint">{AWARD_UI_TEXT.schedule}</small>
      </div>
      {(data.phase === 'announced' || data.phase === 'closed') && <ClaimPanel data={data} busy={busy} onClaim={onClaim} />}
      <Trophies trophies={trophies} title={title} onTitle={onTitle} />
      {data.phase === 'voting' && <Ballots data={data} busy={busy} onVote={onVote} />}
      {(data.phase === 'collecting' || data.phase === 'voting') && <Standings data={data} />}
      {(data.phase === 'announced' || data.phase === 'closed') && <Results data={data} seen={seen} onSeen={onSeen} />}
    </>
  );
}
