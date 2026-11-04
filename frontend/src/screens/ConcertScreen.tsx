import { fmt, fmtCountdown } from '../components/format';
import { PersonaBadge } from '../components/parts';
import { BALANCE, STAGES, manualGameOf, type ManualGame } from '../game/balance';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import { courseConfig } from '../game/runner';
import { hiddenSecretStage, isTourComplete, stageStatus } from '../game/selectors';
import type { StageId } from '../game/types';
import { doAutoConcert, doSkipCooldown, setTourCardOpen, startManualConcert, useUi } from '../store/gameStore';

/** 직접 공연 버튼에 붙는 게임 이름(마이크 타이밍은 따로 이름을 붙이지 않는다) */
const GAME_LABEL: Partial<Record<ManualGame, string>> = { run: '모노사파런', blocks: '무대 세팅 블록', merge: '응원봉 머지 웨이브', bounce: '음파 튕기기', defense: '돌발 사고 막기', survivor: '무대 서바이버', prestige: '월드투어 인크리멘탈', blackout: '정전 속 박자', swipe: '후원 채팅 스와이프', stones: '삼도천 징검다리', galaxy: '은하 노선 잇기' };

/** 무대 세팅 블록 안내 */
function blocksNote(persona: 'normal' | 'dark'): string {
  const base = '악기 블록을 끌어다 8×8 무대에 놓고 가로·세로 줄을 채워 합주를 터뜨려요. 곡이 바뀔 때마다 장비가 고장 나고(불량 칸), 놓을 곳이 없으면 스태프가 한 번 줄을 치워 줘요. 열기 점수 600 이상이면 성공이에요.';
  return persona === 'dark'
    ? `${base} 어둠은 던져진 물건이 더 많이 깔리고 어려운 블록이 일찍 나오고 성공선이 높은 대신 보상 ×${BALANCE.blocks.persona.dark.rewardMult}.`
    : base;
}

/** 응원봉 머지 웨이브 안내 */
function mergeNote(persona: 'normal' | 'dark'): string {
  const base = '같은 색·같은 단계 응원봉이 3개 이상 붙으면 눌러서 한 단계 위로 합쳐요(5개 이상이면 두 단계). 곡마다 열기 목표를 채우면 250점씩, 곡이 끝나면 이펙터를 하나 골라 빌드를 키워요. 열기 점수 600 이상이면 성공이에요.';
  return persona === 'dark'
    ? `${base} 어둠은 야유꾼이 섞여 들어와 응원을 깎고 목표가 높은 대신 보상 ×${BALANCE.merge.persona.dark.rewardMult}.`
    : base;
}

/** 음파 튕기기 안내 */
function bounceNote(persona: 'normal' | 'dark'): string {
  const base = '손가락으로 음파를 쏠 방향을 정하면 음파가 자동으로 나가서 벽에 튕기며 객석 관객을 깨요. 뒷줄(3층)일수록 응원이 커요. 곡마다 열기 목표를 채우면 250점씩, 곡이 끝나면 이펙터를 하나 골라 빌드를 키워요. 열기 점수 600 이상이면 성공이에요.';
  return persona === 'dark'
    ? `${base} 어둠은 음파를 삼키는 방음벽이 섞이고 관객이 단단한 대신 보상 ×${BALANCE.bounce.persona.dark.rewardMult}.`
    : base;
}

/** 돌발 사고 막기 안내 */
function defenseNote(persona: 'normal' | 'dark'): string {
  const base = '위에서 내려오는 사고(하울링·낙하 소품·합선·난입 관객)를 스태프가 자동으로 막아요. 곡 사이에 사고 예보를 보고 직군(음향·무대·조명·안전)을 고용하고, 같은 직군·직급끼리 합쳐서 키워요. 사고를 직접 눌러 거들 수도 있어요. 곡마다 막은 비율만큼 250점씩, 열기 점수 600 이상이면 성공이에요.';
  return persona === 'dark'
    ? `${base} 어둠은 사고가 겹쳐서 나오고, 정전이 불을 꺼서 그 줄 스태프를 느리게 만드는 대신 보상 ×${BALANCE.defense.persona.dark.rewardMult}.`
    : base;
}

/** 무대 서바이버 안내 */
function survivorNote(persona: 'normal' | 'dark'): string {
  const base = '손가락을 끌어 무대를 움직이며 몰려오는 파파라치 드론을 피해요. 조명과 빔은 자동으로 나가고, 쓰러뜨린 드론이 떨어뜨린 응원을 주워 곡마다 열기 목표를 채우면 250점씩이에요. 응원이 쌓여 레벨이 오르거나 곡이 끝나면 퍼크를 하나 골라요. 하트가 다 닳으면 거기서 끝나고, 열기 점수 600 이상이면 성공이에요.';
  return persona === 'dark'
    ? `${base} 어둠은 폭죽 탄막을 쏘는 엘리트 드론이 나오고 목표가 낮은 대신 보상 ×${BALANCE.survivor.persona.dark.rewardMult}.`
    : base;
}

/** 월드투어 인크리멘탈 안내 */
function prestigeNote(persona: 'normal' | 'dark'): string {
  const base = '무대를 눌러 팬을 모으고, 팬으로 대륙 응원단을 사서 자동으로 팬이 늘게 해요. 곡이 끝나면 팬과 응원단이 리셋되는 대신 만든 팬만큼 별빛(영구 배율)을 얻고 영구 퍼크를 하나 골라요. 곡마다 만든 팬이 목표에 가까울수록 250점씩, 열기 점수 600 이상이면 성공이에요.';
  return persona === 'dark'
    ? `${base} 어둠은 비용이 비싸고 별빛 하나의 효과가 약하지만 목표가 낮고 보상 ×${BALANCE.prestige.persona.dark.rewardMult}.`
    : base;
}

/** 정전 속 박자 안내 */
function blackoutNote(): string {
  return `불이 나간 지하에서 4레인 리듬을 쳐요. 노트는 판정선 가까이 와야만 보이고(콤보가 쌓일수록 멀리 보여요) 박자음은 계속 들려요. 노트가 없는 곳을 누르면 헛손질이에요. 곡마다 맞힌 비율만큼 250점씩, 열기 점수 600 이상이면 성공이에요. 어둠속성만 입장하는 공연장이라 보상 ×${BALANCE.blackout.persona.dark.rewardMult}.`;
}

/** 후원 채팅 스와이프 안내 */
function swipeNote(): string {
  return `방송 채팅에 올라오는 글을 오른쪽(수락)이나 왼쪽(차단)으로 넘겨요. 곡마다 검열 규칙이 늘어나고(악플 → 링크 → 소액 후원 → 사칭 마크), 규칙에 없는 특징은 그냥 받아야 해요. 제한 시간 안에 못 넘기면 놓친 거예요. 곡마다 열기 목표를 채우면 250점씩, 열기 점수 600 이상이면 성공이에요. 어둠속성만 입장하는 공연장이라 보상 ×${BALANCE.swipe.persona.dark.rewardMult}.`;
}

/** 삼도천 징검다리 안내 */
function stonesNote(): string {
  return `3칸 폭 강의 징검다리를 박자에 맞춰 한 줄씩 건너요. 링이 점에 닿는 순간 누르면 PERFECT, 박자를 놓치면 점수가 깎여요. 물은 풍덩, 도깨비불은 따끔(하트 −1)이고 뒤에서 삼도천 물이 쫓아와요. 하트 ${BALANCE.stones.hearts}개가 다 닳으면 거기서 끝나요. 곡마다 목표 점수를 채우면 250점씩, 열기 점수 600 이상이면 성공이에요. 어둠속성만 입장하는 공연장이라 보상 ×${BALANCE.stones.persona.dark.rewardMult}.`;
}

/** 은하 노선 잇기 안내 */
function galaxyNote(persona: 'normal' | 'dark'): string {
  const base = `정거장(●▲■★)을 끌어서 이어 노선을 만들고 셔틀로 관객을 실어 날라요. 관객은 자기와 다른 모양의 정거장으로 가고 싶어 하고, 길이 다르면 환승으로 갈아타요. 정거장이 정원을 넘은 채 오래 두면 불만이 터져 열기가 깎여요. 곡이 바뀔 때마다 노선 한도와 예비 셔틀이 늘어요. 곡마다 목표 열기를 채우면 250점씩, 열기 점수 600 이상이면 성공이에요.`;
  return persona === 'dark' ? `${base} 어둠은 정거장이 더 빨리 붐벼서 목표가 높은 대신 보상 ×${BALANCE.galaxy.persona.dark.rewardMult}.` : base;
}

/** 모노사파런 안내: 공연장과 자아에 따라 목표 거리가 다르다 */
function runNote(stage: StageId, persona: 'normal' | 'dark'): string {
  const goal = courseConfig(stage, persona).goalM.toLocaleString();
  return persona === 'dark'
    ? `달리면서 점점 빨라져요. ${goal}m를 완주하면 성공, 젤리를 많이 먹을수록 보상이 커져요. 어둠은 보상 ×${BALANCE.run.persona.dark.rewardMult}.`
    : `달리면서 점점 빨라져요. ${goal}m를 완주하면 성공, 젤리를 많이 먹을수록 보상이 커져요.`;
}

/** 직접 공연 종류에 맞는 안내 */
function manualNote(stage: StageId, persona: 'normal' | 'dark'): string {
  switch (manualGameOf(stage)) {
    case 'run':
      return runNote(stage, persona);
    case 'blocks':
      return blocksNote(persona);
    case 'merge':
      return mergeNote(persona);
    case 'bounce':
      return bounceNote(persona);
    case 'defense':
      return defenseNote(persona);
    case 'survivor':
      return survivorNote(persona);
    case 'prestige':
      return prestigeNote(persona);
    case 'blackout':
      return blackoutNote();
    case 'swipe':
      return swipeNote();
    case 'stones':
      return stonesNote();
    case 'galaxy':
      return galaxyNote(persona);
    default:
      return persona === 'dark' ? `어둠은 판정이 더 좁은 대신 보상 ×${BALANCE.concert.personaRewardMult.dark}.` : '';
  }
}

export function ConcertScreen() {
  const ui = useUi();
  const g = ui.game;
  const now = g.lastSettledAt;
  const persona = g.activePersona;

  return (
    <section className="screen" aria-label="공연">
      <h2 className="section-title">공연</h2>
      <p className="muted">
        자동 공연은 기본 코인을 바로 받고 클리어로 인정돼요. 직접 공연(방구석은 마이크 타이밍, 지하 클럽은 모노사파런, 소형 공연장은 무대 세팅 블록, 단콘은 응원봉 머지 웨이브, 중형 공연장은 음파 튕기기)은 더 많이 벌 수 있지만 필수는 아니에요. 공연 보상은 코인이고, 공연장을 처음 클리어하면 다이아도 받아요.
      </p>

      {isTourComplete(g) && (
        <button type="button" className="tour-banner" onClick={() => setTourCardOpen(true)}>
          🏆 첫 투어 완료! 카드 다시 보기
        </button>
      )}

      {STAGES.map((def) => {
        const st = stageStatus(g, def.id, now);
        if (!st.visible) return null;
        const text = STAGE_TEXT[def.id];
        const idx = STAGES.findIndex((s) => s.id === def.id);
        const prevName = idx > 0 ? STAGE_TEXT[STAGES[idx - 1].id].name : null;
        const busy = !!ui.concertRun;
        return (
          <div key={def.id} className={`card stage-card ${st.unlocked ? '' : 'stage-locked'}`}>
            <div className="card-row">
              <h3>
                {st.unlocked ? '🎪' : '🔒'} {text.name}
              </h3>
              <span className="muted">{st.cleared ? `클리어 · 최고 ${st.bestScore || '자동'}${st.bestScore ? '점' : ''}` : '미클리어'}</span>
            </div>
            <p className="muted">{text.blurb}</p>
            <ul className="req-list">
              <li className={st.fansOk ? 'ok' : ''}>
                {st.fansOk ? '✔' : '○'} 팬 {fmt(st.fansRequired)}명 (현재 {fmt(Math.floor(g.fans))})
              </li>
              {prevName && (
                <li className={st.previousCleared ? 'ok' : ''}>
                  {st.previousCleared ? '✔' : '○'} {prevName} 클리어
                </li>
              )}
            </ul>
            <p className="muted">
              기본 🪙 {st.baseCoins}
              {!st.cleared && <> · 첫 클리어 보너스 🪙 {fmt(st.firstClearCoins)} · 💎 {fmt(st.firstClearDiamonds)}</>}
            </p>
            {st.unlocked && st.cooldownLeftMs > 0 && (
              <>
                <p className="cooldown" role="status">
                  ⏳ 쿨다운 {fmtCountdown(st.cooldownLeftMs)} (공연장마다 {BALANCE.concert.cooldownMs / 1000}초)
                </p>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || g.diamonds < BALANCE.diamond.skipCooldown}
                  onClick={() => doSkipCooldown(def.id)}
                >
                  💎 {BALANCE.diamond.skipCooldown}로 쿨다운 건너뛰기 (보유 {fmt(Math.floor(g.diamonds))})
                </button>
              </>
            )}
            {st.darkOnly && (
              <p className={st.personaOk ? 'muted' : 'cooldown'} role="status">
                🕶️ 비밀 공연장 — 어둠속성으로만 입장해요{st.personaOk ? '.' : ' (지금은 일반속성이에요. 작업실에서 어둠으로 바꿔요)'}
              </p>
            )}
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={!st.canRun || busy} onClick={() => doAutoConcert(def.id)}>
                자동 공연
              </button>
              <button type="button" className="btn btn-accent" disabled={!st.canRun || busy} onClick={() => startManualConcert(def.id)}>
                직접 공연{GAME_LABEL[manualGameOf(def.id)] ? ` · ${GAME_LABEL[manualGameOf(def.id)]}` : ''} <PersonaBadge persona={persona} />
              </button>
            </div>
            {st.canRun && (
              <small className="muted">
                직접 공연 자아는 시작할 때 현재 자아({PERSONA_TEXT[persona].short})로 고정돼요. {manualNote(def.id, persona)}
              </small>
            )}
          </div>
        );
      })}
      {hiddenSecretStage(g) && (
        <div className="card stage-card stage-locked">
          <div className="card-row">
            <h3>🔒 ???</h3>
            <span className="muted">비밀 공연장</span>
          </div>
          <p className="muted">유니버스 페스티벌을 클리어하면 어둠속성만 설 수 있는 비밀 공연장이 열려요.</p>
        </div>
      )}
    </section>
  );
}
