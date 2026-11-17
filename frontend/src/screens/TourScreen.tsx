import { useState } from 'react';
import { fmt, fmtDuration } from '../components/format';
import { BALANCE, TOUR_CITIES, TOUR_FLIGHTS, TOUR_HOME, TOUR_REGIONS, tourCityById, tourFlightHours } from '../game/balance';
import { PERSONA_TEXT, TOUR_CITY_TEXT, TOUR_EVENT_TEXT, TOUR_GRADE_TEXT, TOUR_REGION_TEXT, TOUR_TEXT } from '../game/content';
import { bestPersonaFor, hotCityAt, maxTourLegs, nextCities, tourPlan, tourStatus, tourUnlocked, type TourClaim } from '../game/tour';
import type { GameState, Persona, TourCityId } from '../game/types';
import { doAbandonTour, doClaimTour, doStartTour, useUi } from '../store/gameStore';

const R = BALANCE.tour;
const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;
const cityName = (id: string): string => TOUR_CITY_TEXT[id]?.name ?? id;
const gradeName = (g: number): string => TOUR_GRADE_TEXT[g] ?? 'C';
const gradeClass = (g: number): string => `tour-grade tour-grade-${gradeName(g)}`;

/** 지도 위 도시 자리(가로 100 × 세로 62 안의 도식 배치. 실제 위치가 아니라 누르기 쉽게 벌려 놓았다). */
const POS: Record<string, { x: number; y: number }> = {
  seoul: { x: 78, y: 24 },
  tokyo: { x: 91, y: 12 },
  bangkok: { x: 72, y: 41 },
  singapore: { x: 83, y: 51 },
  sydney: { x: 92, y: 58 },
  dubai: { x: 58, y: 40 },
  istanbul: { x: 47, y: 27 },
  london: { x: 33, y: 10 },
  paris: { x: 29, y: 22 },
  berlin: { x: 46, y: 12 },
  newyork: { x: 13, y: 14 },
  la: { x: 6, y: 31 },
  saopaulo: { x: 21, y: 49 },
};

/** 순회공연 「투어 지도」: 서울에서 출발해 도시를 이어 노선을 짜고, 비행·공연이 끝나는 대로 칸마다 정산해요. */
export function TourScreen() {
  const { game: g, tourResult } = useUi();
  if (!tourUnlocked(g)) {
    return (
      <section className="screen" aria-label="순회공연">
        <h2 className="section-title">{TOUR_TEXT.name}</h2>
        <p className="muted">월클 콘서트를 클리어하면 세계를 도는 순회공연이 열려요.</p>
      </section>
    );
  }
  const status = tourStatus(g);
  const hot = hotCityAt(g.lastSettledAt);
  const souvenirs = Object.keys(g.tour.souvenirs).length;
  return (
    <section className="screen" aria-label="순회공연">
      <h2 className="section-title">
        <span aria-hidden>{TOUR_TEXT.icon}</span> {TOUR_TEXT.name}
      </h2>
      <p className="muted">{TOUR_TEXT.blurb}</p>
      <div className="card">
        <div className="card-row">
          <strong>마친 투어 {g.tour.count}번</strong>
          <small className="muted">
            기념품 {souvenirs} / {TOUR_CITIES.length}
          </small>
        </div>
        <p>
          이번 주 핫 도시 <b>🔥 {cityName(hot)}</b> — 그곳 공연의 코인이 ×{R.hotMult}예요.
        </p>
        <small className="muted">
          한 번에 최대 {maxTourLegs(g)}곳까지 갈 수 있어요. 투어를 {R.legsEvery}번 마칠 때마다 한 곳씩 늘어요(최대 {R.maxLegs}곳).
        </small>
      </div>

      {status ? <ActiveTour g={g} /> : <Planner g={g} />}
      {tourResult && <ResultCard claim={tourResult} />}
      <Dex g={g} />
    </section>
  );
}

/* ---------- 노선 짜기 ---------- */

function Planner({ g }: { g: GameState }) {
  const [route, setRoute] = useState<TourCityId[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const max = maxTourLegs(g);
  const hot = hotCityAt(g.lastSettledAt);
  const next = route.length < max ? nextCities(route) : [];
  const plan = tourPlan(g, route, personas);

  const add = (id: TourCityId): void => {
    if (route.length >= max || !next.includes(id)) return;
    setRoute([...route, id]);
    setPersonas([...personas, bestPersonaFor(g, id)]);
  };
  const undo = (): void => {
    setRoute(route.slice(0, -1));
    setPersonas(personas.slice(0, -1));
  };
  const setPersona = (i: number, p: Persona): void => setPersonas(personas.map((x, k) => (k === i ? p : x)));

  return (
    <>
      <h3 className="sub-title">노선 짜기</h3>
      <div className="card">
        <RouteMap route={route} next={next} hot={hot} onPick={add} onUndo={undo} />
        <p className="muted">
          {route.length === 0 ? '서울에서 출발해요. 갈 수 있는 도시를 눌러 노선을 이어 가세요.' : `${route.length} / ${max}곳 · 마지막 도시를 다시 누르면 지워져요.`}
        </p>
        {next.length > 0 && (
          <div className="tour-next" role="group" aria-label="이어 갈 수 있는 도시">
            {next.map((id) => {
              const def = tourCityById(id)!;
              const from = route.length > 0 ? route[route.length - 1] : TOUR_HOME;
              return (
                <button key={id} type="button" className="btn btn-ghost tour-next-btn" onClick={() => add(id)}>
                  {id === hot ? '🔥 ' : ''}
                  {cityName(id)} <small className="muted">✈️ {tourFlightHours(from, id)}시간 · {'★'.repeat(def.tier)}</small>
                </button>
              );
            })}
          </div>
        )}
        {route.length >= max && <small className="muted">더 갈 수 있는 칸이 없어요(최대 {max}곳).</small>}
      </div>

      {plan.legs.length > 0 && (
        <div className="card">
          <div className="card-row">
            <strong>예상 노선</strong>
            <small className="muted">총 {fmtDuration(plan.totalMs)}</small>
          </div>
          <ol className="tour-legs">
            {plan.legs.map((l, i) => (
              <li key={l.city} className="tour-leg">
                <div className="card-row">
                  <strong>
                    {i + 1}. {l.hot ? '🔥 ' : ''}
                    {cityName(l.city)}
                  </strong>
                  <span className={gradeClass(l.grade)} aria-label={`예상 등급 ${gradeName(l.grade)}`}>
                    {gradeName(l.grade)}
                  </span>
                </div>
                <div className="seg" role="group" aria-label={`${cityName(l.city)}에 세울 자아`}>
                  {(['normal', 'dark'] as const).map((p) => (
                    <button key={p} type="button" aria-pressed={personas[i] === p} onClick={() => setPersona(i, p)}>
                      {p === 'normal' ? '🤍' : '🖤'} {PERSONA_TEXT[p].short} ×{tourCityById(l.city)!.affinity[p]}
                    </button>
                  ))}
                </div>
                <small className="muted">
                  ✈️ {l.flightHours}시간 · {fmtDuration(l.durationMs)} · 🪙 {fmt(l.coins)} · 팬 +{pct(l.fansPct)}
                  {l.synergy !== 1 ? ` · 노선 ${l.synergy > 1 ? '+' : ''}${Math.round((l.synergy - 1) * 100)}%` : ''}
                  {l.souvenir ? ` · 🎁 ${TOUR_CITY_TEXT[l.city].souvenir.name}` : ''}
                </small>
              </li>
            ))}
          </ol>
          <p>
            🪙 {fmt(plan.coins)} · 팬 +{fmt(plan.fans)}
            {plan.grand ? ` · 네 지역을 모두 지나요! 마지막 칸 ×${R.grandTour}` : ''}
          </p>
          <small className="muted">예상은 돌발 사건과 ±{Math.round(R.noise * 100)}% 변수를 뺀 값이에요. 출발할 때의 전투력으로 결과가 정해져요.</small>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={!plan.valid} onClick={() => doStartTour(route, personas)}>
              출발!
            </button>
            <button type="button" className="btn btn-ghost" onClick={undo}>
              한 칸 지우기
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setRoute([]);
                setPersonas([]);
              }}
            >
              처음부터
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** 지도: 도시를 누르면 노선에 이어 붙고, 마지막 도시를 다시 누르면 지워진다 */
function RouteMap({ route, next, hot, onPick, onUndo }: { route: readonly TourCityId[]; next: readonly TourCityId[]; hot: TourCityId; onPick: (id: TourCityId) => void; onUndo: () => void }) {
  const chain: string[] = [TOUR_HOME, ...route];
  const onRoute = (a: string, b: string): boolean => chain.some((c, i) => i > 0 && ((chain[i - 1] === a && c === b) || (chain[i - 1] === b && c === a)));
  const last = route[route.length - 1];
  return (
    <svg className="tour-map" viewBox="0 0 100 62" role="group" aria-label="순회공연 지도">
      {TOUR_FLIGHTS.map(([a, b]) => (
        <line key={`${a}-${b}`} className={onRoute(a, b) ? 'tour-edge tour-edge-on' : 'tour-edge'} x1={POS[a].x} y1={POS[a].y} x2={POS[b].x} y2={POS[b].y} />
      ))}
      {[TOUR_HOME, ...TOUR_CITIES.map((c) => c.id)].map((id) => {
        const p = POS[id];
        const isHome = id === TOUR_HOME;
        const inRoute = route.includes(id as TourCityId);
        const canPick = next.includes(id as TourCityId);
        const canUndo = id === last;
        const cls = ['tour-node', isHome ? 'tour-node-home' : '', inRoute ? 'tour-node-on' : '', canPick ? 'tour-node-next' : ''].filter(Boolean).join(' ');
        const act = canPick ? () => onPick(id as TourCityId) : canUndo ? onUndo : undefined;
        return (
          <g
            key={id}
            className={cls}
            role={act ? 'button' : undefined}
            tabIndex={act ? 0 : undefined}
            aria-label={act ? `${cityName(id)} ${canPick ? '추가' : '지우기'}` : cityName(id)}
            onClick={act}
            onKeyDown={act ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), act()) : undefined}
          >
            <circle cx={p.x} cy={p.y} r={isHome ? 3.6 : 3.2} />
            <text x={p.x} y={p.y + 0.9}>
              {isHome ? '🏠' : id === hot ? '🔥' : inRoute ? route.indexOf(id as TourCityId) + 1 : ''}
            </text>
            <text className="tour-node-label" x={p.x} y={p.y + 6.6}>
              {cityName(id)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- 진행 중 ---------- */

function ActiveTour({ g }: { g: GameState }) {
  const [confirming, setConfirming] = useState(false);
  const status = tourStatus(g)!;
  const now = g.lastSettledAt;
  const left = Math.max(0, status.finishAt - now);
  return (
    <>
      <h3 className="sub-title">투어 진행 중</h3>
      <div className="card">
        <div className="card-row">
          <strong>투어 #{status.run.no}</strong>
          <small className="muted">{left > 0 ? `끝날 때까지 ${fmtDuration(left)}` : '모든 공연이 끝났어요'}</small>
        </div>
        <ol className="tour-legs">
          {status.legs.map((l) => {
            const event = l.event ? TOUR_EVENT_TEXT[l.event] : null;
            const shown = event && (l.event === 'delay' || l.phase === 'show' || l.phase === 'done' || l.phase === 'paid');
            return (
              <li key={l.city} className={`tour-leg tour-leg-${l.phase}`}>
                <div className="card-row">
                  <strong>
                    {l.index + 1}. {cityName(l.city)} <small className="muted">{l.persona === 'normal' ? '🤍' : '🖤'} {PERSONA_TEXT[l.persona].short}</small>
                  </strong>
                  <small className="muted">
                    {l.phase === 'paid' && '✔ 정산했어요'}
                    {l.phase === 'done' && '🎁 정산할 수 있어요'}
                    {l.phase === 'show' && `🎤 공연 중 · ${fmtDuration(l.endAt - now)}`}
                    {l.phase === 'flight' && `✈️ 비행 중 · 도착까지 ${fmtDuration(l.arriveAt - now)}`}
                    {l.phase === 'wait' && `⏳ ${fmtDuration(l.departAt - now)} 뒤 출발`}
                  </small>
                </div>
                {shown && event && (
                  <small className={`radio-note radio-note-${event.tone}`}>
                    {event.icon} {event.text}
                  </small>
                )}
              </li>
            );
          })}
        </ol>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={status.due === 0} onClick={() => doClaimTour()}>
            {status.due === 0 ? '아직 끝난 공연이 없어요' : `정산 받기 (${status.due}곳)`}
          </button>
          {!confirming ? (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(true)}>
              투어 중단
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-accent" onClick={() => doAbandonTour()}>
                정말 중단할게요
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                취소
              </button>
            </>
          )}
        </div>
        {confirming && <small className="muted">끝난 공연은 먼저 정산하고, 남은 도시는 사라져요. 마친 투어로 세지 않아요.</small>}
      </div>
    </>
  );
}

/* ---------- 결과·도감 ---------- */

function ResultCard({ claim }: { claim: TourClaim }) {
  return (
    <>
      <h3 className="sub-title">방금 정산한 공연</h3>
      <div className="card" role="status">
        <ul className="tour-results">
          {claim.results.map((r) => (
            <li key={r.index} className="card-row">
              <span>
                <span className={gradeClass(r.grade)}>{gradeName(r.grade)}</span> {r.hot ? '🔥 ' : ''}
                {cityName(r.city)}
                {r.souvenir ? ` 🎁 ${TOUR_CITY_TEXT[r.city].souvenir.name}` : ''}
                {r.grand ? ' 🌐 완주' : ''}
              </span>
              <small className="muted">
                🪙 {fmt(r.coins)} · 팬 +{fmt(r.fans)}
                {r.diamonds > 0 ? ` · 💎 +${r.diamonds}` : ''}
              </small>
              {r.event && (
                <small className={`radio-note radio-note-${TOUR_EVENT_TEXT[r.event].tone}`}>
                  {TOUR_EVENT_TEXT[r.event].icon} {TOUR_EVENT_TEXT[r.event].text}
                </small>
              )}
            </li>
          ))}
        </ul>
        <p>
          합계 🪙 {fmt(claim.coins)} · 팬 +{fmt(claim.fans)}
          {claim.diamonds > 0 ? ` · 💎 +${claim.diamonds}` : ''}
          {claim.finished ? ' · 🎉 투어를 마쳤어요!' : ''}
        </p>
      </div>
    </>
  );
}

function Dex({ g }: { g: GameState }) {
  return (
    <>
      <h3 className="sub-title">기념품 도감</h3>
      {TOUR_REGIONS.map((region) => {
        const cities = TOUR_CITIES.filter((c) => c.region === region);
        const have = cities.filter((c) => g.tour.souvenirs[c.id] !== undefined).length;
        const t = TOUR_REGION_TEXT[region];
        return (
          <div key={region} className="card">
            <div className="card-row">
              <h3>
                <span aria-hidden>{t.icon}</span> {t.name}
              </h3>
              <small className="muted">
                {have} / {cities.length} · {t.vibe} +{pct(have * R.souvenirBonus + (have === cities.length ? R.regionBonus : 0))}
              </small>
            </div>
            <ul className="tour-dex">
              {cities.map((c) => {
                const got = g.tour.souvenirs[c.id] !== undefined;
                const best = g.tour.best[c.id];
                return (
                  <li key={c.id} className="card-row">
                    <span>
                      {got ? TOUR_CITY_TEXT[c.id].souvenir.icon : '❔'} {cityName(c.id)} <small className="muted">{'★'.repeat(c.tier)}</small>
                    </span>
                    <small className="muted">
                      {got ? TOUR_CITY_TEXT[c.id].souvenir.name : 'A 등급 이상이면 기념품을 받아요'}
                      {best !== undefined ? ` · 최고 ${gradeName(best)}` : ''}
                    </small>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <p className="fineprint">
        기념품 하나마다 그 지역의 갈래가 +{pct(R.souvenirBonus)}, 한 지역(세 도시)을 다 모으면 +{pct(R.regionBonus)}와 💎 {R.regionDiamonds}가 더해져요. 열두 도시를 다 모으면 💎 {R.allDiamonds}를 한 번 더 받아요.
      </p>
    </>
  );
}
