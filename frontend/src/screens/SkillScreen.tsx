import { Progress } from '../components/parts';
import { BALANCE, SKILL_IDS } from '../game/balance';
import { LEVEL_SKILL_TEXT } from '../game/content';
import { playerLevel } from '../game/selectors';
import { levelsToNextPoint, skillPerLevel, skillPointsEarned, skillPointsFree, skillPointsSpent } from '../game/skills';
import type { SkillId } from '../game/types';
import { doBuySkill, doRespecSkills, useUi } from '../store/gameStore';

/** 한 단계가 올려 주는 값의 표시: 비율은 %, 오프라인 상한은 분 */
const perLevelText = (id: SkillId): string => (id === 'offline' ? `+${skillPerLevel(id) / 60_000}분` : `+${Math.round(skillPerLevel(id) * 1000) / 10}%`);
const totalText = (id: SkillId, level: number): string => (id === 'offline' ? `+${(skillPerLevel(id) * level) / 60_000}분` : `+${Math.round(skillPerLevel(id) * level * 1000) / 10}%`);

/** 레벨 스킬: 플레이어 레벨이 오르면 받는 포인트를 다섯 갈래에 찍는다. 다이아로 모두 돌려받아 다시 찍을 수 있다. */
export function SkillScreen() {
  const { game: g } = useUi();
  const S = BALANCE.skills;
  const earned = skillPointsEarned(g.fans);
  const spent = skillPointsSpent(g.skills);
  const free = skillPointsFree(g);
  const canRespec = spent > 0 && g.diamonds >= S.respecCost;

  return (
    <section className="screen" aria-label="레벨 스킬">
      <h2 className="section-title">레벨 스킬</h2>
      <p className="muted">
        플레이어 레벨이 {S.levelsPerPoint}오를 때마다 포인트 1개를 받아요. 갈래마다 최대 {S.maxLevel}단계까지 찍을 수 있고, 효과는 두 자아 모두에 적용돼요.
      </p>

      <div className="stat-grid stat-grid-3">
        <div>
          <strong>{free}</strong>
          <span>쓸 수 있는 포인트</span>
        </div>
        <div>
          <strong>
            {spent}/{earned}
          </strong>
          <span>찍은 / 받은</span>
        </div>
        <div>
          <strong>Lv.{playerLevel(g.fans)}</strong>
          <span>다음 포인트까지 {levelsToNextPoint(g.fans)}레벨</span>
        </div>
      </div>

      {SKILL_IDS.map((id) => {
        const t = LEVEL_SKILL_TEXT[id];
        const level = g.skills[id] ?? 0;
        const maxed = level >= S.maxLevel;
        return (
          <div key={id} className="card equip-card">
            <div className="card-row">
              <h3>
                <span aria-hidden>{t.icon}</span> {t.name} <small>{level}/{S.maxLevel}</small>
              </h3>
              <strong>{totalText(id, level)}</strong>
            </div>
            <Progress value={level} max={S.maxLevel} label={`${t.name} 단계`} />
            <p className="muted">
              {t.effect} ({perLevelText(id)} / 단계)
            </p>
            {maxed ? (
              <p className="maxed">최대 단계 ✨</p>
            ) : (
              <button type="button" className="btn btn-primary btn-wide" disabled={free < 1} onClick={() => doBuySkill(id)}>
                {free >= 1 ? `포인트 1개 찍기 (${totalText(id, level)} → ${totalText(id, level + 1)})` : '포인트가 없어요'}
              </button>
            )}
          </div>
        );
      })}

      <div className="card">
        <div className="card-row">
          <h3>🔄 다시 찍기</h3>
          <small className="muted">💎 {S.respecCost}</small>
        </div>
        <p className="muted">찍은 포인트를 모두 돌려받아 처음부터 다시 정해요.</p>
        <button type="button" className="btn btn-accent btn-wide" disabled={!canRespec} onClick={doRespecSkills}>
          {spent <= 0 ? '찍은 포인트가 없어요' : canRespec ? `다시 찍기 💎 ${S.respecCost}` : `💎 ${S.respecCost} 필요 (보유 ${Math.floor(g.diamonds)})`}
        </button>
      </div>
    </section>
  );
}
