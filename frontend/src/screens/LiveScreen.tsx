import { useState } from 'react';
import { FandomLive } from './live/FandomLive';
import { LyricLive } from './live/LyricLive';

type Game = 'lyric' | 'fandom' | null;

const GAMES = [
  { id: 'lyric' as const, icon: '🎤', name: '가사 빈칸 속도전', desc: '가사 한 줄에서 서버가 비운 빈칸을 가장 빨리 채워요. 최대 8명, 8문제.', hint: '다른 팬과 함께하면 순위 보상' },
  { id: 'fandom' as const, icon: '🐍', name: '팬덤 모으기', desc: '팬 점을 먹어 행렬을 키우고 남의 행렬을 끊어요. 한 판 최대 3분, 봇이 같이 달려요.', hint: '팬을 모을수록 보상' },
];

/** 라이브 대전: 별도 소켓 서버에서 다른 팬들과 실시간으로 하는 미니게임 모음. */
export function LiveScreen() {
  const [game, setGame] = useState<Game>(null);
  const meta = GAMES.find((g) => g.id === game);
  return (
    <section className="screen" aria-label="라이브 대전">
      <h2 className="section-title">라이브 대전</h2>
      {!game && (
        <>
          <p className="muted">다른 팬들과 같은 시각에 함께하는 미니게임이에요. 보상은 우편함으로 가요.</p>
          {GAMES.map((g) => (
            <div key={g.id} className="card">
              <div className="card-row">
                <h3>
                  <span aria-hidden>{g.icon}</span> {g.name}
                </h3>
                <small className="muted">{g.hint}</small>
              </div>
              <p className="muted">{g.desc}</p>
              <button type="button" className="btn btn-primary btn-wide" onClick={() => setGame(g.id)}>
                입장하기
              </button>
            </div>
          ))}
        </>
      )}
      {game && meta && (
        <>
          <div className="card-row">
            <h3>
              <span aria-hidden>{meta.icon}</span> {meta.name}
            </h3>
            <button type="button" className="btn btn-ghost" onClick={() => setGame(null)}>
              ← 목록
            </button>
          </div>
          {game === 'lyric' && <LyricLive onExit={() => setGame(null)} />}
          {game === 'fandom' && <FandomLive onExit={() => setGame(null)} />}
        </>
      )}
    </section>
  );
}
