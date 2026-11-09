import { useState } from 'react';
import { PersonaBadge } from '../components/parts';
import { fmt, fmtCountdown } from '../components/format';
import { arcadeBlocked, arcadeCooldownLeft } from '../game/arcade';
import type { RhythmLevel } from '../game/arcade';
import { BALANCE, LYRIC_CARDS } from '../game/balance';
import { ARCADE_TEXT, DIFFICULTY_TEXT, LYRIC_CARD_TEXT, PERSONA_TEXT, RHYTHM_LEVEL_TEXT } from '../game/content';
import { deckSize } from '../game/lyricdeck';
import { TRACKS, trackOfSingle, trackSingles } from '../game/songcharts';
import type { ArcadeKind, GameState, Persona } from '../game/types';
import { towerStatus } from '../game/tower';
import { bonuses } from '../game/packdata';
import { doTrimLyricCard, setTab, startArcade, startTower, useUi } from '../store/gameStore';

const LEVELS: RhythmLevel[] = ['easy', 'normal', 'hard'];

/** 아케이드 시작 버튼 한 줄: 쿨다운·첫 싱글 조건을 글자로 알려 준다. */
function StartButton({ g, kind, onStart, label }: { g: GameState; kind: ArcadeKind; onStart: () => void; label: string }) {
  const blocked = arcadeBlocked(g, kind);
  const left = arcadeCooldownLeft(g, kind);
  return (
    <button type="button" className="btn btn-primary btn-wide" disabled={blocked !== null} onClick={onStart}>
      {blocked === 'need_single' ? '첫 싱글을 발매하면 열려요' : blocked === 'need_track' ? '음원 곡을 발매하면 열려요' : left > 0 ? `쿨다운 ${fmtCountdown(left)}` : label}
    </button>
  );
}

export function ArcadeScreen() {
  const { game: g } = useUi();
  const b = bonuses(g);
  return (
    <section className="screen" aria-label="아케이드">
      <h2 className="section-title">아케이드</h2>
      <p className="muted">
        직접 플레이하면 코인·팬·다이아를 줘요. 시작하면 쿨다운이 정해지고, 곡 카드·피처링·포토 세트의 전투력 보너스(지금 +{Math.round(b.power * 100)}%)가 판정과 전투력에 더해져요.
      </p>
      <RhythmCard g={g} />
      <SurvivalCard g={g} />
      <LyricCard g={g} />
      <TicketCard g={g} />
      <SlashCard g={g} />
      <HoleCard g={g} />
      <GateCard g={g} />
      <PlinkoCard g={g} />
      <TowerCard g={g} />
    </section>
  );
}

function Head({ k }: { k: keyof typeof ARCADE_TEXT }) {
  const t = ARCADE_TEXT[k];
  return (
    <>
      <div className="card-row">
        <h3>
          <span aria-hidden>{t.icon}</span> {t.name}
        </h3>
      </div>
      <p className="muted">{t.blurb}</p>
    </>
  );
}

function RhythmCard({ g }: { g: GameState }) {
  // 리듬 모드는 음원이 있는 곡으로만 플레이한다.
  const songs = trackSingles([...g.singles].reverse());
  const [pick, setPick] = useState('');
  const [level, setLevel] = useState<RhythmLevel>('normal');
  const target = songs.some((s) => s.id === pick) ? pick : (songs[0]?.id ?? '');
  const cfg = BALANCE.rhythm.levels[level];
  const track = trackOfSingle(songs.find((s) => s.id === target));
  return (
    <div className="card">
      <Head k="rhythm" />
      {songs.length === 0 ? (
        <p className="empty">
          {TRACKS.map((t) => `${PERSONA_TEXT[t.persona].short}속성 「${t.title}」`).join(', ')} 싱글을 발매하면 플레이할 수 있어요.
        </p>
      ) : (
        <>
          {songs.length > 1 ? (
            <label className="field">
              <small className="muted">곡 고르기</small>
              <select value={target} onChange={(e) => setPick(e.target.value)}>
                {songs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {PERSONA_TEXT[s.persona].short} · {s.title}
                    {g.arcade.rhythm.songs[s.id] ? ` (최고 ${g.arcade.rhythm.songs[s.id]})` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>
              <span aria-hidden>♪</span> <strong>{songs[0].title}</strong>
              <small className="muted">
                {' '}
                · {PERSONA_TEXT[songs[0].persona].short}
                {g.arcade.rhythm.songs[songs[0].id] ? ` · 최고 ${g.arcade.rhythm.songs[songs[0].id]}` : ''}
              </small>
            </p>
          )}
          <div className="seg" role="group" aria-label="난이도">
            {LEVELS.map((l) => (
              <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}>
                {RHYTHM_LEVEL_TEXT[l]}
              </button>
            ))}
          </div>
          <small className="muted">
            {track ? `♪ 음원 곡 ${track.playMs / 1000}초 · ${track.bpm} BPM` : `${cfg.beats}박`} · 보상 ×{cfg.mult} · 최고 {g.arcade.rhythm.best}점 · {g.counters.rhythms}번 플레이
          </small>
        </>
      )}
      <StartButton g={g} kind="rhythm" label="플레이" onStart={() => target && startArcade('rhythm', { target, level })} />
    </div>
  );
}

function SurvivalCard({ g }: { g: GameState }) {
  const dark = g.activePersona === 'dark';
  return (
    <div className="card">
      <Head k="survival" />
      <small className="muted">
        지금 자아 <PersonaBadge persona={g.activePersona} /> · {dark ? '어둠은 과열이 체력이에요. 공격이 강하지만 더 아프게 맞아요.' : '일반은 균형형이에요.'} · 최고 {g.arcade.survival.best}점
      </small>
      <StartButton g={g} kind="survival" label="3분 버티기" onStart={() => startArcade('survival')} />
    </div>
  );
}

function LyricCard({ g }: { g: GameState }) {
  const cards = g.arcade.lyric.cards;
  const total = deckSize(cards);
  return (
    <div className="card">
      <Head k="lyric" />
      <small className="muted">
        덱 {total}장 · 최고 {g.arcade.lyric.best}점
        {g.arcade.lyric.bonus > 0 ? ` · 📝 다음 싱글 팬 +${Math.round(g.arcade.lyric.bonus * 100)}%` : ''}
      </small>
      <details>
        <summary>덱 보기·정리</summary>
        <ul className="lyric-deck">
          {LYRIC_CARDS.filter((c) => (cards[c.id] ?? 0) > 0).map((c) => (
            <li key={c.id}>
              <span>
                {LYRIC_CARD_TEXT[c.id]} ×{cards[c.id]}
              </span>
              <button type="button" className="btn btn-ghost" disabled={total <= BALANCE.lyric.minDeck} onClick={() => doTrimLyricCard(c.id)}>
                한 장 빼기
              </button>
            </li>
          ))}
        </ul>
        <p className="fineprint">덱은 {BALANCE.lyric.minDeck}장 아래로 줄일 수 없고 {BALANCE.lyric.maxDeck}장까지 늘릴 수 있어요. 곡을 완성하면 새 카드를 하나 고를 수 있어요.</p>
      </details>
      <StartButton g={g} kind="lyric" label="곡 만들기" onStart={() => startArcade('lyric')} />
    </div>
  );
}

function TicketCard({ g }: { g: GameState }) {
  const boost = g.arcade.ticketing.boost;
  const active = boost && boost.until > g.lastSettledAt ? boost : null;
  return (
    <div className="card">
      <Head k="ticketing" />
      {active && (
        <p className="buff-note" role="status">
          🎟️ 다음 공연 코인 ×{active.mult.toFixed(2)} · {fmtCountdown(active.until - g.lastSettledAt)} 남음
        </p>
      )}
      <small className="muted">최고 {g.arcade.ticketing.best}점</small>
      <StartButton g={g} kind="ticketing" label="티켓 오픈 대기" onStart={() => startArcade('ticketing')} />
    </div>
  );
}

/** 점수만 남는 짧은 게임 한 장: 자아 한 줄 설명·최고 점수·플레이 횟수와 시작 버튼 */
function SimpleCard({ g, kind, note, label, played }: { g: GameState; kind: 'slash' | 'hole' | 'gate' | 'plinko'; note: string; label: string; played: number }) {
  return (
    <div className="card">
      <Head k={kind} />
      <small className="muted">
        지금 자아 <PersonaBadge persona={g.activePersona} /> · {note} · 최고 {g.arcade[kind].best}점 · {played}번 플레이
      </small>
      <StartButton g={g} kind={kind} label={label} onStart={() => startArcade(kind)} />
    </div>
  );
}

function SlashCard({ g }: { g: GameState }) {
  const dark = g.activePersona === 'dark';
  return <SimpleCard g={g} kind="slash" label="45초 베기" played={g.counters.slashes} note={dark ? '어둠은 벤 악플이 둘로 쪼개져요(체력 8)' : `체력 ${BALANCE.slash.hp}`} />;
}

function HoleCard({ g }: { g: GameState }) {
  const dark = g.activePersona === 'dark';
  return <SimpleCard g={g} kind="hole" label="60초 먹기" played={g.counters.holes} note={dark ? '어둠은 더 빨리 자라지만 라이벌이 사나워요' : '라이벌 구멍 둘과 겨뤄요'} />;
}

function GateCard({ g }: { g: GameState }) {
  const dark = g.activePersona === 'dark';
  return <SimpleCard g={g} kind="gate" label="행진 시작" played={g.counters.gates} note={dark ? '어둠은 −·÷ 게이트가 많고 ×3이 나와요' : `처음 ${BALANCE.gate.start}명으로 출발`} />;
}

function PlinkoCard({ g }: { g: GameState }) {
  const dark = g.activePersona === 'dark';
  return <SimpleCard g={g} kind="plinko" label="구슬 쏘기" played={g.counters.plinkos} note={dark ? '어둠은 데미지가 세지만 야유 핀이 섞여요' : `괴수 ${BALANCE.plinko.hp.length}마리, 구슬 ${BALANCE.plinko.balls}개씩`} />;
}

function TowerCard({ g }: { g: GameState }) {
  const st = towerStatus(g);
  const e = st.enemy;
  const personas: Persona[] = ['normal', 'dark'];
  const locked = g.singles.length < 1;
  return (
    <div className="card">
      <Head k="tower" />
      <div className="stat-grid">
        <div>
          <strong>{st.floor}층</strong>
          <span>이번 주 도전</span>
        </div>
        <div>
          <strong>{st.best}층</strong>
          <span>역대 최고</span>
        </div>
        <div>
          <strong>{fmt(Math.round(e.power))}</strong>
          <span>{e.boss ? '보스 ' : ''}적 전투력</span>
        </div>
      </div>
      <small className="muted">
        이 층의 약점은 <PersonaBadge persona={e.weak} /> — 약점 자아로 도전하면 전투력 ×{BALANCE.tower.weakMult}
      </small>
      <div className="tower-row">
        {personas.map((p) => (
          <button key={p} type="button" className={`btn ${p === e.weak ? 'btn-primary' : 'btn-ghost'} tower-btn`} disabled={locked || st.cooldownLeftMs > 0} onClick={() => startTower(p)}>
            <span>{PERSONA_TEXT[p].short}으로 도전</span>
            <small>
              전투력 {fmt(Math.round(st.power[p]))} · {DIFFICULTY_TEXT[st.difficulty[p]]}
            </small>
          </button>
        ))}
      </div>
      {locked && <small className="muted">첫 싱글을 발매하면 열려요.</small>}
      {st.cooldownLeftMs > 0 && <small className="muted">다시 도전까지 {fmtCountdown(st.cooldownLeftMs)}</small>}
      <p className="fineprint">매주 월요일에 1층으로 돌아가고 이번 주에 처음 깬 층만 보상을 줘요(보스층·{BALANCE.tower.milestoneEvery}층마다 다이아). 시작하면 {BALANCE.tower.failCooldownMs / 1000}초 쿨다운이 정해지고 이기면 바로 풀려요. 역대 최고 층은 랭킹에 올라요.</p>
      <button type="button" className="btn btn-ghost" onClick={() => setTab('ranking')}>
        🏆 계단 랭킹 보러 가기
      </button>
    </div>
  );
}
