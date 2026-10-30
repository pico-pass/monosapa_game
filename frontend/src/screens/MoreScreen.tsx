import { moreAlerts } from '../game/alerts';
import { setTab, useUi, type TabId } from '../store/gameStore';

const ITEMS: { id: TabId; icon: string; name: string; desc: string; alert?: 'missions' | 'mail' | 'monogram' | 'collect' }[] = [
  { id: 'shop', icon: '🛒', name: '상점', desc: '간식·홍보 캠페인·테마' },
  { id: 'missions', icon: '📅', name: '미션·출석', desc: '일일·주간 미션 보상', alert: 'missions' },
  { id: 'achievements', icon: '🏅', name: '업적·칭호', desc: '달성하고 칭호를 달아요' },
  { id: 'mail', icon: '💌', name: '팬 DM', desc: '응원·공감·안티 메시지', alert: 'mail' },
  { id: 'monogram', icon: '📸', name: '모노그램', desc: '게시물로 팬을 모아요', alert: 'monogram' },
  { id: 'collect', icon: '🃏', name: '수집', desc: '곡 카드·포토카드·피처링·마스코트', alert: 'collect' },
  { id: 'arcade', icon: '🎮', name: '아케이드', desc: '리듬·생존·가사 덱·계단·피켓팅' },
  { id: 'challenge', icon: '#️⃣', name: '해시태그 챌린지', desc: '주간 주제로 한 줄 가사' },
  { id: 'chart', icon: '📈', name: '음원 차트', desc: '실시간 TOP100과 순위 보상' },
  { id: 'wrapped', icon: '🎁', name: '결산 Wrapped', desc: '내 기록을 카드로 공유' },
  { id: 'sampler', icon: '🎙️', name: '목소리 샘플러', desc: '내 목소리로 패드와 비트' },
  { id: 'chat', icon: '💬', name: '챗방', desc: '모두가 쓰는 자유 채팅' },
  { id: 'inquiry', icon: '📮', name: '문의함', desc: '버그·제안·계정 문의' },
  { id: 'stats', icon: '📊', name: '통계', desc: '스트리밍 기록과 정산' },
  { id: 'ranking', icon: '🏆', name: '랭킹', desc: '계정 레벨·무한의 계단 순위' },
  { id: 'collection', icon: '📚', name: '도감', desc: '곡·앨범·공연장 기록' },
];

export function MoreScreen() {
  const { game: g } = useUi();
  const alerts = moreAlerts(g);
  return (
    <section className="screen" aria-label="더보기">
      <h2 className="section-title">더보기</h2>
      <div className="more-grid">
        {ITEMS.map((it) => {
          const n = it.alert ? alerts[it.alert] : 0;
          return (
            <button key={it.id} type="button" className="more-item" onClick={() => setTab(it.id)}>
              <span className="more-icon" aria-hidden>
                {it.icon}
              </span>
              <strong>{it.name}</strong>
              <small>{it.desc}</small>
              {n > 0 && (
                <span className="dot-badge" aria-label={`${n}개 있음`}>
                  {n > 9 ? '9+' : n}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
