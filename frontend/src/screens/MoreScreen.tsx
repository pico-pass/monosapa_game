import { moreAlerts } from '../game/alerts';
import { useAuth } from '../store/authStore';
import { setTab, useUi, type TabId } from '../store/gameStore';
import { friendBadge, mailBadge, useSocial } from '../store/socialStore';

const ITEMS: { id: TabId; icon: string; name: string; desc: string; alert?: 'missions' | 'mail' | 'monogram' | 'collect' | 'nurture' | 'skills' | 'stats' | 'village'; social?: 'postbox' | 'friends' | 'village' | 'boss' }[] = [
  { id: 'shop', icon: '🛒', name: '상점', desc: '간식·홍보 캠페인·테마' },
  { id: 'missions', icon: '📅', name: '미션·출석', desc: '일일·주간 미션 보상', alert: 'missions' },
  { id: 'achievements', icon: '🏅', name: '업적·칭호', desc: '달성하고 칭호를 달아요 · 끝없는 업적' },
  { id: 'skills', icon: '🌟', name: '레벨 스킬', desc: '레벨 포인트를 찍어 영구히 강해져요', alert: 'skills' },
  { id: 'mail', icon: '💌', name: '팬 DM', desc: '응원·공감·안티 메시지', alert: 'mail' },
  { id: 'monogram', icon: '📸', name: '모노그램', desc: '게시물로 팬을 모아요', alert: 'monogram' },
  { id: 'collect', icon: '🃏', name: '수집', desc: '곡 카드·포토카드·피처링·마스코트', alert: 'collect' },
  { id: 'village', icon: '🏘️', name: '팬 마을', desc: '건물을 지어 ❤️와 영구 보너스를 모아요', alert: 'village', social: 'village' },
  { id: 'boss', icon: '👹', name: '월드 보스', desc: '모두 함께 이번 주 보스를 쓰러뜨려요', social: 'boss' },
  { id: 'nurture', icon: '🍼', name: '모노사파 육성', desc: '밥·놀이·술로 키우고 레벨로 강해져요', alert: 'nurture' },
  { id: 'arcade', icon: '🎮', name: '아케이드', desc: '리듬·생존·가사 덱·계단·피켓팅' },
  { id: 'challenge', icon: '#️⃣', name: '해시태그 챌린지', desc: '주간 주제로 한 줄 가사' },
  { id: 'chart', icon: '📈', name: '음원 차트', desc: '실시간 TOP100과 순위 보상' },
  { id: 'wrapped', icon: '🎁', name: '결산 Wrapped', desc: '내 기록을 카드로 공유' },
  { id: 'sampler', icon: '🎙️', name: '목소리 샘플러', desc: '내 목소리로 패드와 비트' },
  { id: 'chat', icon: '💬', name: '챗방', desc: '모두가 쓰는 자유 채팅' },
  { id: 'friends', icon: '🤝', name: '친구', desc: '친구 추가·하루 한 번 💎 선물·개인 채팅', social: 'friends' },
  { id: 'postbox', icon: '📬', name: '우편함', desc: '친구 선물과 운영 안내', social: 'postbox' },
  { id: 'inquiry', icon: '📮', name: '문의함', desc: '버그·제안·계정 문의' },
  { id: 'stats', icon: '📊', name: '통계', desc: '스트리밍 기록·정산·인증', alert: 'stats' },
  { id: 'ranking', icon: '🏆', name: '랭킹', desc: '계정 레벨·무한의 계단 순위' },
  { id: 'collection', icon: '📚', name: '도감', desc: '곡·앨범·공연장 기록' },
];

export function MoreScreen() {
  const { game: g } = useUi();
  const alerts = moreAlerts(g);
  const { user } = useAuth();
  const { summary } = useSocial();
  const items = user?.isAdmin ? [...ITEMS, { id: 'admin' as TabId, icon: '🛡️', name: '관리자', desc: '신고 처리·우편 보내기·이용 제한' }] : ITEMS;
  return (
    <section className="screen" aria-label="더보기">
      <h2 className="section-title">더보기</h2>
      <div className="more-grid">
        {items.map((it) => {
          const social = it.social === 'postbox' ? mailBadge(summary) : it.social === 'friends' ? friendBadge(summary) : it.social === 'village' ? summary.villageFlags : it.social === 'boss' ? summary.bossClaimable : 0;
          const n = (it.alert ? alerts[it.alert] : 0) + social;
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
