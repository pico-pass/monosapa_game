import { useCallback, useEffect, useState } from 'react';
import { Avatar, type AvatarKind } from '../components/Avatar';
import { fmt } from '../components/format';
import { BALANCE, VENUE_DEVICES, type VenueDeviceDef, type VenueDeviceKind } from '../game/balance';
import { STAGE_TEXT, VENUE_DEVICE_TEXT, VENUE_KIND_TEXT, VENUE_STAT_TEXT, VENUE_UI_TEXT, venueDeviceEffect } from '../game/content';
import type { GameState, Persona, VenueDeviceId } from '../game/types';
import { GRADE_LETTERS, MAX_GRADE, VENUE_CELLS, deviceCount, deviceUnlocked, ownPlayCoins, ownPlayWaitMs, placedCount, scoreVenue, uploadIssue, venueMult, venueUnlocked, visitCoins, type VenueScore } from '../game/venue';
import { api, errorText } from '../platform/api';
import type { MyVenueBody, MyVenueData, VenueBrief, VenueListData, VenueSort } from '../platform/venues';
import { doClaimVenueWeekly, doClearVenue, doPlaceDevice, doPlayOwnVenue, doSetVenueName, doSetVenueTheme, doUploadVenue, doVisitVenue, toast, useUi } from '../store/gameStore';
import { openProfile, openReport, refreshSummary } from '../store/socialStore';
import { Modal } from '../components/Modal';

type VenueTab = 'build' | 'browse' | 'mine';
type Selected = VenueDeviceId | 'erase';

const V = BALANCE.venue;
const SORTS: VenueSort[] = ['popular', 'new', 'friends'];
/** 능력치 막대의 가득 찬 값(막대 길이를 정하는 기준일 뿐 점수 상한이 아니다) */
const STAT_BAR_MAX = { glam: 40, sound: 24, safety: 12, mood: 15 } as const;
const SHOW_MS = 1800;
/** 장치 칸 종류 순서 */
const KIND_ORDER: VenueDeviceKind[] = ['light', 'fx', 'sound', 'safety', 'mood'];

const gradeText = (grade: number): string => GRADE_LETTERS[Math.max(0, Math.min(MAX_GRADE, grade))];
const multText = (grade: number): string => `×${venueMult(grade).toFixed(2)}`;
const deviceLabel = (id: VenueDeviceId | null): string => (id ? VENUE_DEVICE_TEXT[id].name : '빈 칸');

/** 내 무대 화면: 꾸미기(8×6 바닥에 장치 놓기) · 둘러보기(남의 무대에서 공연) · 내 무대(올린 무대 통계·주간 인기 보상). 점수·등급·좋아요·방문은 서버가 정한다. */
export function VenueScreen() {
  const { game: g } = useUi();
  const [tab, setTab] = useState<VenueTab>('build');
  const [sel, setSel] = useState<Selected>('spot');
  const [mine, setMine] = useState<MyVenueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<VenueSort>('popular');
  const [list, setList] = useState<VenueListData | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [show, setShow] = useState<ShowState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const open = venueUnlocked(g.fans);

  const loadMine = useCallback(async () => {
    try {
      setMine(await api<MyVenueData>('venues/me'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  const loadList = useCallback(async (s: VenueSort, page: number) => {
    try {
      const res = await api<VenueListData>(`venues?sort=${s}&page=${page}`);
      setList((prev) => (page > 0 && prev ? { ...res, venues: [...prev.venues, ...res.venues] } : res));
      setListError(null);
    } catch (e) {
      setListError(errorText(e));
    }
  }, []);

  useEffect(() => {
    if (open) void loadMine();
  }, [open, loadMine]);
  useEffect(() => {
    if (open && tab === 'browse') void loadList(sort, 0);
  }, [open, tab, sort, loadList]);
  // 내 무대 공연 쿨다운을 1초마다 다시 센다
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);
  // 공연 연출이 끝나면 결과를 보여 준다
  const phase = show?.phase;
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setTimeout(() => setShow((s) => (s ? { ...s, phase: 'done' } : s)), SHOW_MS);
    return () => clearTimeout(id);
  }, [phase]);

  const upload = async () => {
    setBusy(true);
    const res = await doUploadVenue();
    if (res) {
      setMine(res);
      void refreshSummary();
    }
    setBusy(false);
  };
  const ownPlay = () => {
    const r = doPlayOwnVenue();
    if (r) setShow({ title: g.venue.name.trim() || '내 무대', cells: g.venue.cells, theme: g.venue.theme, grade: r.grade, lines: [`🪙 +${fmt(r.coins)}`], phase: g.settings.reducedMotion ? 'done' : 'playing' });
  };
  const visit = async (v: VenueBrief) => {
    setBusy(true);
    const r = await doVisitVenue(v.id);
    if (r) {
      setShow({ title: v.name, cells: v.cells, theme: v.theme, grade: r.grade, lines: [`🪙 +${fmt(r.coins)}`, r.rentPaid ? `주인에게 대관료 💎${V.rentFee}이 갔어요.` : '주인의 오늘 대관료 한도가 차서 대관료는 가지 않았어요.'], phase: g.settings.reducedMotion ? 'done' : 'playing' });
      setList((l) => (l ? { ...l, visitsLeft: r.visitsLeft, venues: l.venues.map((x) => (x.id === v.id ? { ...x, visitedToday: true, plays: x.plays + 1 } : x)) } : l));
    }
    setBusy(false);
  };
  const like = async (v: VenueBrief) => {
    setBusy(true);
    try {
      const r = await api<{ likes: number; liked: boolean }>(`venues/${v.id}/like`, { method: 'POST' });
      setList((l) => (l ? { ...l, venues: l.venues.map((x) => (x.id === v.id ? { ...x, likes: r.likes, liked: r.liked } : x)) } : l));
    } catch (e) {
      toast(errorText(e), 'warn');
    }
    setBusy(false);
  };
  const claim = async () => {
    setBusy(true);
    await doClaimVenueWeekly();
    await Promise.all([loadMine(), refreshSummary()]);
    setBusy(false);
  };

  return (
    <section className="screen" aria-label="내 무대">
      <h2 className="section-title">🏗️ {VENUE_UI_TEXT.title}</h2>
      {!open ? (
        <div className="card">
          <p className="muted">팬 {V.unlockFans.toLocaleString('ko-KR')}명부터 내 무대를 꾸밀 수 있어요. (지금 팬 {fmt(g.fans)}명)</p>
          <p className="fineprint">{VENUE_UI_TEXT.intro}</p>
        </div>
      ) : (
        <>
          <div className="seg" role="group" aria-label="내 무대 메뉴">
            {(['build', 'browse', 'mine'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
                {VENUE_UI_TEXT.tabs[t]}
              </button>
            ))}
          </div>
          {error && (
            <p className="muted" role="alert">
              {error}
            </p>
          )}
          {tab === 'build' && (
            <BuildPanel
              game={g}
              now={now}
              sel={sel}
              busy={busy}
              uploaded={mine?.venue ?? null}
              onSel={setSel}
              onCell={(i) => doPlaceDevice(i, sel === 'erase' ? null : g.venue.cells[i] === sel ? null : sel)}
              onName={doSetVenueName}
              onTheme={doSetVenueTheme}
              onClear={doClearVenue}
              onUpload={() => void upload()}
              onOwn={ownPlay}
            />
          )}
          {tab === 'browse' && (
            <BrowsePanel
              list={list}
              sort={sort}
              error={listError}
              busy={busy}
              game={g}
              onSort={(s) => {
                setList(null);
                setSort(s);
              }}
              onVisit={(v) => void visit(v)}
              onLike={(v) => void like(v)}
              onReport={(v) => openReport({ kind: 'venue', refId: v.id, label: v.owner.name })}
              onOwner={(uid) => openProfile(uid)}
              onMore={() => list && void loadList(sort, list.page + 1)}
            />
          )}
          {tab === 'mine' && <MinePanel game={g} data={mine} busy={busy} onClaim={() => void claim()} onBuild={() => setTab('build')} />}
        </>
      )}
      {show && <ShowModal show={show} onClose={() => setShow(null)} />}
    </section>
  );
}

/** 올린 무대(서버)와 지금 초안이 같은 모양인가 */
export function sameAsUploaded(game: Pick<GameState, 'venue'>, body: MyVenueBody | null): boolean {
  if (!body) return false;
  const v = game.venue;
  return body.name === v.name.replace(/\s+/g, ' ').trim() && body.theme === v.theme && body.cells.length === v.cells.length && body.cells.every((c, i) => c === v.cells[i]);
}

/* ---------- 바닥(그리드) ---------- */

export interface GridProps {
  cells: readonly (VenueDeviceId | null)[];
  /** 위험한 연출 장치가 있는 칸 번호(편집 화면에서만 표시) */
  hazards?: readonly number[];
  /** 주어지면 칸이 눌리는 버튼이 된다 */
  onCell?: (index: number) => void;
  /** 공연 연출 중 장치가 반짝인다 */
  lit?: boolean;
  /** 작은 미리보기(둘러보기 목록) */
  mini?: boolean;
  theme: Persona;
}

/** 8열 × 6행 무대 바닥. 가운데 세로선(4번째와 5번째 열 사이)은 스피커 좌우 대칭의 기준이다. */
export function VenueGrid({ cells, hazards = [], onCell, lit = false, mini = false, theme }: GridProps) {
  const bad = new Set(hazards);
  return (
    <div className={`vn-grid${mini ? ' vn-mini' : ''}${lit ? ' vn-lit-on' : ''}`} data-theme={theme} role={onCell ? 'group' : 'img'} aria-label={onCell ? '무대 바닥 8열 6행' : '무대 모양'}>
      {Array.from({ length: VENUE_CELLS }, (_, i) => {
        const id = cells[i] ?? null;
        const cls = `vn-cell${id ? ` vn-k-${venueDeviceKind(id)}` : ''}${bad.has(i) ? ' vn-bad' : ''}`;
        const icon = id ? VENUE_DEVICE_TEXT[id].icon : '';
        const style = lit && id ? { animationDelay: `${(i % V.w) * 90 + Math.floor(i / V.w) * 40}ms` } : undefined;
        if (!onCell) {
          return (
            <span key={i} className={cls} style={style} aria-hidden>
              {icon}
            </span>
          );
        }
        const r = Math.floor(i / V.w) + 1;
        const c = (i % V.w) + 1;
        return (
          <button key={i} type="button" className={cls} onClick={() => onCell(i)} aria-label={`${r}행 ${c}열 ${deviceLabel(id)}${bad.has(i) ? ' (위험)' : ''}`}>
            {icon}
            {bad.has(i) && (
              <span className="vn-warn" aria-hidden>
                ⚠️
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const venueDeviceKind = (id: VenueDeviceId): VenueDeviceKind => VENUE_DEVICES.find((d) => d.id === id)?.kind ?? 'light';

/* ---------- 꾸미기 ---------- */

export interface BuildPanelProps {
  game: GameState;
  now: number;
  sel: Selected;
  busy: boolean;
  /** 서버에 올라가 있는 내 무대(없으면 null) */
  uploaded: MyVenueBody | null;
  onSel: (s: Selected) => void;
  onCell: (index: number) => void;
  onName: (name: string) => void;
  onTheme: (theme: Persona) => void;
  onClear: () => void;
  onUpload: () => void;
  onOwn: () => void;
}

function nextGradeText(score: VenueScore): string {
  if (score.grade >= MAX_GRADE) return '최고 등급이에요!';
  const need = V.gradeMin[score.grade + 1] - score.total;
  return `다음 등급 ${gradeText(score.grade + 1)}까지 ${(Math.round(need * 10) / 10).toLocaleString('ko-KR')}점`;
}

export function BuildPanel({ game, now, sel, busy, uploaded, onSel, onCell, onName, onTheme, onClear, onUpload, onOwn }: BuildPanelProps) {
  const v = game.venue;
  const score = scoreVenue(v.cells, v.theme);
  const issue = uploadIssue(game);
  const wait = ownPlayWaitMs(v, now);
  const same = sameAsUploaded(game, uploaded);
  const rules = { lightFxMult: V.lightFxMult, speakerSymmetryMult: V.speakerSymmetryMult, hazardPenalty: V.hazardPenalty };
  const stats = (['glam', 'sound', 'safety', 'mood'] as const).map((k) => ({ k, value: score[k] }));
  return (
    <>
      <p className="fineprint">{VENUE_UI_TEXT.intro}</p>
      <div className="card vn-grade-card">
        <div className={`vn-grade vn-grade-${score.grade}`} aria-label={`무대 등급 ${gradeText(score.grade)}`}>
          {gradeText(score.grade)}
        </div>
        <div className="vn-grade-info">
          <strong>
            {score.total.toLocaleString('ko-KR')}점 · 무대 배율 {multText(score.grade)}
          </strong>
          <small className="muted">{nextGradeText(score)}</small>
          {score.devices > 0 && score.lights < 1 && (
            <small className="vn-note-bad" role="note">
              💡 조명이 없어요 — 등급이 C까지예요.
            </small>
          )}
          {score.devices > 0 && score.sounds < 1 && (
            <small className="vn-note-bad" role="note">
              🔊 음향이 없어요 — 등급이 C까지예요.
            </small>
          )}
          {score.hazards > 0 && (
            <small className="vn-note-bad" role="note">
              ⚠️ 위험한 연출 장치 {score.hazards}곳 — 주변 한 칸 안에 안전바를 놓아요. (안전 −{V.hazardPenalty * score.hazards})
            </small>
          )}
        </div>
      </div>

      <VenueGrid cells={v.cells} hazards={score.hazardCells} onCell={onCell} theme={v.theme} />
      <p className="fineprint">장치를 고른 뒤 칸을 눌러 놓아요. 같은 장치가 있는 칸을 다시 누르면 치워져요. 가운데 선은 스피커 좌우 대칭의 기준이에요.</p>

      <div className="vn-stats" role="list" aria-label="능력치">
        {stats.map(({ k, value }) => {
          const t = VENUE_STAT_TEXT[k];
          const pct = Math.max(0, Math.min(100, (value / STAT_BAR_MAX[k]) * 100));
          return (
            <div key={k} role="listitem" className="vn-stat">
              <span>
                {t.icon} {t.name}
              </span>
              <span className="vn-bar" aria-hidden>
                <span className={`vn-fill vn-fill-${k}`} style={{ width: `${pct}%` }} />
              </span>
              <strong>{value.toLocaleString('ko-KR')}</strong>
            </div>
          );
        })}
      </div>
      {v.theme === 'normal' && VENUE_DEVICES.some((d) => d.kind === 'mood' && v.cells.includes(d.id)) && <p className="fineprint">분위기 장치는 어둠 무대에서만 점수에 반영돼요.</p>}

      <Palette game={game} sel={sel} rules={rules} onSel={onSel} />

      <div className="card">
        <label className="field vn-name">
          <span>무대 이름 ({V.nameMin}~{V.nameMax}자)</span>
          <input type="text" value={v.name} maxLength={V.nameMax} placeholder="예: 새벽 3시 라이브하우스" onChange={(e) => onName(e.target.value)} />
        </label>
        <div className="card-row">
          <span className="muted">무대 분위기</span>
          <div className="seg seg-tight" role="group" aria-label="무대 분위기">
            {(['normal', 'dark'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={v.theme === t} onClick={() => onTheme(t)}>
                {t === 'normal' ? '☀️ 일반' : '🌑 어둠'}
              </button>
            ))}
          </div>
        </div>
        <div className="vn-actions">
          <button type="button" className="btn btn-primary" disabled={busy || issue !== null} onClick={onUpload}>
            {same ? '✔ 올린 무대와 같아요' : uploaded ? '🔄 바뀐 무대 올리기' : '⬆️ 서버에 올리기'}
          </button>
          <button type="button" className="btn" disabled={placedCount(v.cells) === 0 || wait > 0} onClick={onOwn}>
            {placedCount(v.cells) === 0 ? '🎤 내 무대 공연' : wait > 0 ? `🎤 내 무대 공연 (${Math.ceil(wait / 60_000)}분 뒤)` : `🎤 내 무대 공연 🪙 +${fmt(Math.floor(ownPlayCoins(game)))}`}
          </button>
          <button type="button" className="btn btn-ghost" disabled={placedCount(v.cells) === 0} onClick={onClear}>
            🧹 모두 치우기
          </button>
        </div>
        {issue === 'name' && <small className="muted">무대 이름을 지으면 올릴 수 있어요.</small>}
        {issue === 'empty' && <small className="muted">장치를 하나 이상 놓으면 올릴 수 있어요.</small>}
        <small className="fineprint">내 무대 공연은 30분에 한 번, 인세 {V.ownSecs / 60}분 분량 × 무대 배율의 코인을 받아요. 이름은 운영 규칙을 지켜 주세요(신고되면 숨겨져요).</small>
      </div>
    </>
  );
}

function Palette({ game, sel, rules, onSel }: { game: GameState; sel: Selected; rules: { lightFxMult: number; speakerSymmetryMult: number; hazardPenalty: number }; onSel: (s: Selected) => void }) {
  const placed = game.venue.cells;
  return (
    <div className="card vn-palette">
      <div className="card-row">
        <strong>장치 상자</strong>
        <button type="button" className="btn btn-ghost" aria-pressed={sel === 'erase'} onClick={() => onSel('erase')}>
          🧽 지우개{sel === 'erase' ? ' ✔' : ''}
        </button>
      </div>
      {KIND_ORDER.map((kind) => {
        const defs = VENUE_DEVICES.filter((d) => d.kind === kind);
        const k = VENUE_KIND_TEXT[kind];
        return (
          <div key={kind} className="vn-kind">
            <small className="muted">
              {k.icon} {k.name}
            </small>
            <div className="vn-devices">
              {defs.map((d) => (
                <DeviceButton key={d.id} def={d} unlocked={deviceUnlocked(game, d)} count={deviceCount(placed, d.id)} selected={sel === d.id} rules={rules} onSel={onSel} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeviceButton({ def, unlocked, count, selected, rules, onSel }: { def: VenueDeviceDef; unlocked: boolean; count: number; selected: boolean; rules: { lightFxMult: number; speakerSymmetryMult: number; hazardPenalty: number }; onSel: (s: Selected) => void }) {
  const t = VENUE_DEVICE_TEXT[def.id];
  return (
    <button type="button" className={`vn-device${selected ? ' vn-picked' : ''}${unlocked ? '' : ' vn-locked'}`} aria-pressed={selected} disabled={!unlocked} onClick={() => onSel(def.id)} title={unlocked ? venueDeviceEffect(def, rules) : undefined}>
      <span className="vn-dev-icon" aria-hidden>
        {unlocked ? t.icon : '🔒'}
      </span>
      <span className="vn-dev-name">{t.name}</span>
      <small className="muted">{unlocked ? `${count}/${def.max}` : `${STAGE_TEXT[def.unlock!].name} 클리어`}</small>
      {unlocked && <small className="vn-dev-effect">{venueDeviceEffect(def, rules)}</small>}
    </button>
  );
}

/* ---------- 둘러보기 ---------- */

export interface BrowsePanelProps {
  list: VenueListData | null;
  sort: VenueSort;
  error: string | null;
  busy: boolean;
  game: GameState;
  onSort: (s: VenueSort) => void;
  onVisit: (v: VenueBrief) => void;
  onLike: (v: VenueBrief) => void;
  onReport: (v: VenueBrief) => void;
  onOwner: (uid: string) => void;
  onMore: () => void;
}

export function BrowsePanel({ list, sort, error, busy, game, onSort, onVisit, onLike, onReport, onOwner, onMore }: BrowsePanelProps) {
  return (
    <>
      <div className="seg seg-tight" role="group" aria-label="정렬">
        {SORTS.map((s) => (
          <button key={s} type="button" aria-pressed={sort === s} onClick={() => onSort(s)}>
            {VENUE_UI_TEXT.sorts[s]}
          </button>
        ))}
      </div>
      <p className="fineprint">
        남의 무대에서 하루 {V.visitsPerDay}곳까지 공연하고(같은 무대는 하루 한 번), 인세 {V.visitSecs / 60}분 분량 × (등급이 높을수록 더 많이)의 코인을 받아요. 공연하면 주인에게 대관료 💎{V.rentFee}이 우편으로 가요.
        {list && ` 오늘 ${list.visitsLeft}곳 더 갈 수 있어요.`}
      </p>
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <p className="muted">불러오는 중…</p>}
      {list && list.venues.length === 0 && <p className="empty">{sort === 'friends' ? '친구가 올린 무대가 아직 없어요.' : '아직 올라온 무대가 없어요. 내 무대를 먼저 올려 보세요!'}</p>}
      {list && list.venues.length > 0 && (
        <ul className="vn-list">
          {list.venues.map((v) => (
            <VenueCard key={v.id} v={v} game={game} busy={busy} visitsLeft={list.visitsLeft} onVisit={onVisit} onLike={onLike} onReport={onReport} onOwner={onOwner} />
          ))}
        </ul>
      )}
      {list?.hasMore && (
        <button type="button" className="btn" disabled={busy} onClick={onMore}>
          더 보기
        </button>
      )}
    </>
  );
}

function VenueCard({ v, game, busy, visitsLeft, onVisit, onLike, onReport, onOwner }: { v: VenueBrief; game: GameState; busy: boolean; visitsLeft: number; onVisit: BrowsePanelProps['onVisit']; onLike: BrowsePanelProps['onLike']; onReport: BrowsePanelProps['onReport']; onOwner: BrowsePanelProps['onOwner'] }) {
  const reason = v.mine ? '내 무대예요' : v.visitedToday ? '오늘 공연했어요' : visitsLeft <= 0 ? '오늘은 더 못 가요' : null;
  return (
    <li className="card vn-card">
      <VenueGrid cells={v.cells} theme={v.theme} mini />
      <div className="vn-card-main">
        <div className="vn-card-head">
          <span className={`vn-grade vn-grade-${v.grade} vn-grade-mini`} aria-label={`등급 ${gradeText(v.grade)}`}>
            {gradeText(v.grade)}
          </span>
          <strong className="vn-card-name">{v.name}</strong>
          {v.theme === 'dark' && <span aria-label="어둠 무대">🌑</span>}
        </div>
        <button type="button" className="vn-owner" onClick={() => onOwner(v.owner.uid)}>
          <Avatar name={v.owner.name} picture={v.owner.picture} avatar={v.owner.avatar as AvatarKind} />
          <small>{v.owner.name}</small>
        </button>
        <small className="muted">
          {v.score.toLocaleString('ko-KR')}점 · 공연 {v.plays.toLocaleString('ko-KR')}회 · 코인 +{fmt(visitCoins(game, v.grade))}
        </small>
        <div className="vn-card-actions">
          <button type="button" className={`btn btn-ghost vn-like${v.liked ? ' vn-liked' : ''}`} disabled={busy || v.mine} onClick={() => onLike(v)} aria-label={`좋아요 ${v.likes}개`}>
            {v.liked ? '❤️' : '🤍'} {v.likes}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || reason !== null} onClick={() => onVisit(v)}>
            {reason ?? '🎤 공연하러 가기'}
          </button>
          {!v.mine && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onReport(v)} aria-label="무대 신고">
              🚩
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/* ---------- 내 무대 ---------- */

export interface MinePanelProps {
  game: GameState;
  data: MyVenueData | null;
  busy: boolean;
  onClaim: () => void;
  onBuild: () => void;
}

export function MinePanel({ game, data, busy, onClaim, onBuild }: MinePanelProps) {
  if (!data) return <p className="muted">불러오는 중…</p>;
  const venue = data.venue;
  const w = data.weekly;
  return (
    <>
      {!venue ? (
        <div className="card">
          <p className="muted">아직 올린 무대가 없어요. 장치를 놓고 이름을 지어 서버에 올리면 다른 팬들이 공연하러 와요.</p>
          <button type="button" className="btn btn-primary" onClick={onBuild}>
            🏗️ 무대 꾸미러 가기
          </button>
        </div>
      ) : (
        <div className="card vn-mine">
          <VenueGrid cells={venue.cells} theme={venue.theme} mini />
          <div className="vn-card-head">
            <span className={`vn-grade vn-grade-${venue.grade} vn-grade-mini`} aria-label={`등급 ${gradeText(venue.grade)}`}>
              {gradeText(venue.grade)}
            </span>
            <strong>{venue.name || '(이름이 지워졌어요)'}</strong>
          </div>
          {venue.hidden && (
            <p className="vn-note-bad" role="alert">
              🚫 운영팀 조치로 숨겨졌어요. 이름을 새로 지어 다시 올리면 다시 공개돼요.
            </p>
          )}
          <div className="vn-mine-stats">
            <span>🎤 공연 {venue.plays.toLocaleString('ko-KR')}회</span>
            <span>❤️ 좋아요 {venue.likes.toLocaleString('ko-KR')}</span>
            <span>✨ {venue.score.toLocaleString('ko-KR')}점 · {multText(venue.grade)}</span>
          </div>
          {!sameAsUploaded(game, venue) && !venue.hidden && <small className="muted">지금 꾸미는 무대가 올린 무대와 달라요. 꾸미기에서 「바뀐 무대 올리기」를 눌러야 반영돼요.</small>}
          <small className="fineprint">
            다른 팬이 공연하면 대관료 💎{V.rentFee}이 우편으로 와요(하루 최대 {V.rentDailyMax}번). 올린 뒤에도 내가 꾸민 무대의 배율은 내 무대 공연에 바로 적용돼요.
          </small>
        </div>
      )}
      <div className="card">
        <strong>🏆 주간 인기 무대</strong>
        <small className="muted">
          매주 월요일에 지난주 좋아요를 가장 많이 받은 무대 3곳이 💎 {V.weeklyRewards.join('·')}을 받아요.
        </small>
        {w.diamonds !== null ? (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onClaim}>
            🏗️ 지난주 {w.rank}위 보상 💎 {w.diamonds} 받기
          </button>
        ) : w.claimed ? (
          <small className="aw-voted">✔ 지난주 보상을 받았어요 ({w.rank}위)</small>
        ) : (
          <small className="muted">지난주에는 순위권에 들지 못했어요. 친구들에게 내 무대를 알려 보세요!</small>
        )}
      </div>
    </>
  );
}

/* ---------- 공연 연출 ---------- */

export interface ShowState {
  title: string;
  cells: (VenueDeviceId | null)[];
  theme: Persona;
  grade: number;
  /** 결과 줄(코인·대관료 안내) */
  lines: string[];
  phase: 'playing' | 'done';
}

export function ShowModal({ show, onClose }: { show: ShowState; onClose: () => void }) {
  const playing = show.phase === 'playing';
  return (
    <Modal title={playing ? '🎤 공연 중…' : '🎉 공연 끝!'} tone={show.theme === 'dark' ? 'dark' : 'gold'} onClose={playing ? undefined : onClose} footer={playing ? <div className="modal-footer" /> : undefined}>
      <div className="vn-show">
        <strong>{show.title}</strong>
        <VenueGrid cells={show.cells} theme={show.theme} lit={playing} />
        {!playing && (
          <>
            <p className="vn-show-grade">
              무대 등급 <b>{gradeText(show.grade)}</b> ({multText(show.grade)})
            </p>
            {show.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
