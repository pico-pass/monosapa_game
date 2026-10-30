import { useState } from 'react';
import { Progress } from '../components/parts';
import { fmt } from '../components/format';
import { ACHIEVEMENT_TEXT } from '../game/content';
import { achievementStatuses, titleText } from '../game/achievements';
import { doSetTitle, useUi } from '../store/gameStore';

type Filter = 'all' | 'done' | 'todo';

export function AchievementScreen() {
  const { game: g } = useUi();
  const [filter, setFilter] = useState<Filter>('all');
  const all = achievementStatuses(g);
  const done = all.filter((a) => a.done).length;
  const shown = all.filter((a) => (filter === 'all' ? true : filter === 'done' ? a.done : !a.done));
  const title = titleText(g);

  return (
    <section className="screen" aria-label="업적과 칭호">
      <h2 className="section-title">업적·칭호</h2>
      <p className="muted">
        {done} / {all.length} 달성. 달성하면 다이아를 받고, 칭호가 있는 업적은 칭호를 달 수 있어요. 칭호는 챗방에도 보여요.
      </p>
      <div className="card">
        <div className="card-row">
          <h3>🎖️ 지금 칭호</h3>
          <strong>{title ? `「${title}」` : '없음'}</strong>
        </div>
        {g.cosmetics.title && (
          <button type="button" className="btn btn-ghost" onClick={() => doSetTitle(null)}>
            칭호 떼기
          </button>
        )}
      </div>

      <div className="seg" role="group" aria-label="업적 보기">
        {(
          [
            ['all', '전체'],
            ['done', '달성'],
            ['todo', '미달성'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>

      <ul className="ach-list">
        {shown.map((a) => {
          const t = ACHIEVEMENT_TEXT[a.def.id];
          const equipped = g.cosmetics.title === a.def.id;
          return (
            <li key={a.def.id} className={`card ach-row${a.done ? ' ach-done' : ''}`}>
              <span className="ach-icon" aria-hidden>
                {a.done ? t.icon : '🔒'}
              </span>
              <div className="ach-main">
                <strong>{t.name}</strong>
                <small className="muted">{t.desc}</small>
                {!a.done && <Progress value={a.value} max={a.def.goal} label={`${t.name} 진행도`} />}
                <small className="muted">
                  {a.done ? '달성 ✔' : `${fmt(a.value)} / ${fmt(a.def.goal)}`} · 💎 {a.def.diamonds}
                </small>
              </div>
              {a.done && t.title && (
                <button type="button" className="btn btn-ghost" aria-pressed={equipped} onClick={() => doSetTitle(equipped ? null : a.def.id)}>
                  {equipped ? '다는 중' : `「${t.title}」 달기`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
