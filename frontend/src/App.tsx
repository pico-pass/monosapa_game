import { useEffect, useState } from 'react';
import { bgm } from './audio/bgm';
import { Modal } from './components/Modal';
import { PersonaBadge } from './components/parts';
import { fmt, fmtDuration, fmtHave, fmtRate, fmtStreamRate, fmtStreams } from './components/format';
import { BALANCE } from './game/balance';
import { CLICK_POWER_TEXT, PERSONA_TEXT, STAGE_TEXT } from './game/content';
import { moreAlerts } from './game/alerts';
import { bonuses } from './game/packdata';
import {
  albumRoyaltyBonus,
  albumRoyaltyOf,
  clickGain,
  clickPowerOf,
  diamondProductionMult,
  offlineCapMs,
  playerLevel,
  productionMultiplier,
  rhymeRate,
  royaltyBreakdown,
  streamRate,
} from './game/selectors';
import { AchievementScreen } from './screens/AchievementScreen';
import { ArcadeScreen } from './screens/ArcadeScreen';
import { ArcadeStage } from './screens/ArcadeStage';
import { ChallengeScreen } from './screens/ChallengeScreen';
import { ChartScreen } from './screens/ChartScreen';
import { CollectScreen } from './screens/CollectScreen';
import { ChatScreen } from './screens/ChatScreen';
import { CollectionScreen } from './screens/CollectionScreen';
import { ConcertScreen } from './screens/ConcertScreen';
import { ConcertStage } from './screens/ConcertStage';
import { EquipScreen } from './screens/EquipScreen';
import { InquiryScreen } from './screens/InquiryScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MailScreen } from './screens/MailScreen';
import { MissionScreen } from './screens/MissionScreen';
import { MonogramScreen } from './screens/MonogramScreen';
import { MoreScreen } from './screens/MoreScreen';
import { RankingScreen } from './screens/RankingScreen';
import { ReleaseScreen } from './screens/ReleaseScreen';
import { GachaModal, TowerModal } from './screens/ResultModals';
import { SamplerScreen } from './screens/SamplerScreen';
import { SettingsSheet } from './screens/SettingsSheet';
import { ShopScreen } from './screens/ShopScreen';
import { StatsScreen } from './screens/StatsScreen';
import { StudioScreen } from './screens/StudioScreen';
import { WrappedScreen } from './screens/WrappedScreen';
import {
  boot,
  MORE_TABS,
  dismissAlbum,
  dismissOfflineReport,
  dismissRelease,
  closeConcertResult,
  recoverBackup,
  setBasisOpen,
  setSettingsOpen,
  setTab,
  setTourCardOpen,
  startNewAfterCorrupt,
  takeOver,
  useUi,
  type TabId,
} from './store/gameStore';
import { initAuth, useAuth } from './store/authStore';

const ALBUM_KIND = { normal: '일반', dark: '어둠' } as const;

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'studio', label: '작업실', icon: '🎙️' },
  { id: 'release', label: '발매', icon: '💿' },
  { id: 'equip', label: '장비', icon: '🎛️' },
  { id: 'concert', label: '공연', icon: '🎪' },
  { id: 'more', label: '더보기', icon: '☰' },
];

const SUB_TITLE: Partial<Record<TabId, string>> = {
  stats: '통계',
  ranking: '랭킹',
  collection: '도감',
  shop: '상점',
  missions: '미션·출석',
  achievements: '업적·칭호',
  mail: '팬 DM',
  monogram: '모노그램',
  chat: '챗방',
  inquiry: '문의함',
  collect: '수집',
  arcade: '아케이드',
  challenge: '해시태그 챌린지',
  chart: '음원 차트',
  wrapped: '결산',
  sampler: '목소리 샘플러',
};

export function App() {
  const ui = useUi();
  const auth = useAuth();
  const userId = auth.user?.id;
  const signedIn = !!userId;

  useEffect(() => {
    void initAuth();
  }, []);

  // 로그인한 뒤에야 저장을 불러오고 게임 틱을 시작한다.
  useEffect(() => {
    if (userId) void boot(userId);
  }, [userId]);

  if (auth.status === 'loading') return <div className="center-screen">불러오는 중…</div>;
  if (!signedIn) return <LoginScreen />;
  if (ui.phase === 'booting') return <div className="center-screen">불러오는 중…</div>;
  if (ui.phase === 'readonly') return <ReadOnlyScreen />;
  if (ui.phase === 'corrupt') return <CorruptScreen />;
  return <Game />;
}

function Game() {
  const ui = useUi();
  const g = ui.game;
  const persona = g.activePersona;
  const { muted, bgmMuted } = g.settings;
  const ducked = !!ui.concertRun || !!ui.arcadeRun;

  // 배경음악: 자아가 바뀌면 곡이 교차 페이드되고, 직접 공연 중에는 작아진다.
  useEffect(() => {
    bgm.configure({ persona, muted, bgmMuted, ducked });
  }, [persona, muted, bgmMuted, ducked]);

  const inMore = MORE_TABS.includes(ui.tab);
  const navTab: TabId = inMore ? 'more' : ui.tab;
  const alerts = moreAlerts(g);

  return (
    <div className={`app${g.settings.reducedMotion ? ' reduce-motion' : ''}`} data-persona={persona} data-theme={g.cosmetics.theme}>
      <TopBar />
      {ui.saveError && (
        <div className="banner banner-warn" role="alert">
          저장 문제: {ui.saveError}
        </div>
      )}
      <main className="main" id="main">
        {inMore && (
          <button type="button" className="back-btn" onClick={() => setTab('more')}>
            ← 더보기 <span className="muted">/ {SUB_TITLE[ui.tab]}</span>
          </button>
        )}
        {ui.tab === 'studio' && <StudioScreen />}
        {ui.tab === 'release' && <ReleaseScreen />}
        {ui.tab === 'equip' && <EquipScreen />}
        {ui.tab === 'concert' && <ConcertScreen />}
        {ui.tab === 'stats' && <StatsScreen />}
        {ui.tab === 'ranking' && <RankingScreen />}
        {ui.tab === 'collection' && <CollectionScreen />}
        {ui.tab === 'more' && <MoreScreen />}
        {ui.tab === 'shop' && <ShopScreen />}
        {ui.tab === 'missions' && <MissionScreen />}
        {ui.tab === 'achievements' && <AchievementScreen />}
        {ui.tab === 'mail' && <MailScreen />}
        {ui.tab === 'monogram' && <MonogramScreen />}
        {ui.tab === 'chat' && <ChatScreen />}
        {ui.tab === 'inquiry' && <InquiryScreen />}
        {ui.tab === 'collect' && <CollectScreen />}
        {ui.tab === 'arcade' && <ArcadeScreen />}
        {ui.tab === 'challenge' && <ChallengeScreen />}
        {ui.tab === 'chart' && <ChartScreen />}
        {ui.tab === 'wrapped' && <WrappedScreen />}
        {ui.tab === 'sampler' && <SamplerScreen />}
      </main>
      <nav className="tabs" aria-label="메인 메뉴">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${navTab === t.id ? 'tab-on' : ''}`} aria-current={navTab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
            {t.id === 'more' && alerts.total > 0 && <i className="tab-dot" aria-label="할 일이 있어요" />}
          </button>
        ))}
      </nav>

      <Toasts />
      <Overlays />
    </div>
  );
}

function TopBar() {
  const { game: g, tab } = useUi();
  const level = playerLevel(g.fans);
  const zero = g.singles.length === 0;
  return (
    <header className="topbar">
      <button type="button" className="resources" onClick={() => setBasisOpen(true)} aria-label="코인·팬·레벨·다이아. 누르면 계산 근거를 봅니다">
        <span className="res">
          <i aria-hidden>🪙</i>
          <strong>{fmtHave(g.coins)}</strong>
          <small>코인</small>
        </span>
        <span className="res">
          <i aria-hidden>👥</i>
          <strong>{fmtHave(g.fans)}</strong>
          <small>팬</small>
        </span>
        <span className="res">
          <i aria-hidden>⭐</i>
          <strong>Lv.{level}</strong>
          <small>레벨</small>
        </span>
        <span className="res">
          <i aria-hidden>💎</i>
          <strong>{fmtHave(g.diamonds)}</strong>
          <small>다이아</small>
        </span>
      </button>
      <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="설정">
        ⚙️
      </button>
      {zero && tab === 'studio' && (
        <p className="zero-note">0인 이유: 아직 발매한 곡이 없어요 — 첫 싱글이 첫 수입이에요.</p>
      )}
    </header>
  );
}

function Toasts() {
  const { toasts } = useUi();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Overlays() {
  const ui = useUi();
  const g = ui.game;
  const { releaseResult: rel, albumResult: alb, concertResult: cr } = ui;

  // 한 번에 하나의 모달만: 오프라인 결과 > 공연 > 발매 > 앨범 > 투어 > 설정 > 계산 근거
  return (
    <>
      {ui.concertRun && <ConcertStage run={ui.concertRun} />}
      {ui.arcadeRun && !ui.concertRun && <ArcadeStage run={ui.arcadeRun} />}
      {ui.offlineReport && <OfflineModal />}
      {!ui.offlineReport && !ui.concertRun && cr && (
        <Modal title={cr.cleared ? '자동 공연 완료' : '공연 결과'} onClose={closeConcertResult} tone={cr.cleared ? 'gold' : 'normal'}>
          <p>
            <b>{STAGE_TEXT[cr.stageId].name}</b> {cr.mode === 'auto' ? '자동 공연 클리어' : ''}
          </p>
          <ul className="reward-list">
            <li>
              🪙 코인 <b>+{fmt(cr.coins)}</b>
              {cr.firstClear && <small> (첫 클리어 보너스 {fmt(cr.firstClearCoins)} 포함)</small>}
            </li>
            {cr.diamonds > 0 && (
              <li>
                💎 다이아 <b>+{fmt(cr.diamonds)}</b> <small>(첫 클리어)</small>
              </li>
            )}
          </ul>
        </Modal>
      )}
      {!ui.offlineReport && !ui.concertRun && !cr && rel && (
        <Modal title="싱글 발매!" onClose={dismissRelease} tone={rel.persona}>
          <p className="song-title">
            <PersonaBadge persona={rel.persona} /> 「{rel.single.title}」
          </p>
          <ul className="reward-list">
            <li>
              🪙 코인 <b>+{fmt(rel.coins)}</b>
            </li>
            <li>
              👥 팬 <b>+{fmt(rel.fans)}</b>
            </li>
            {rel.diamonds > 0 && (
              <li>
                💎 다이아 <b>+{fmt(rel.diamonds)}</b> <small>(레벨 업!)</small>
              </li>
            )}
          </ul>
          <h3 className="sub-title">가상 댓글</h3>
          <ul className="comments">
            {rel.comments.map((c) => (
              <li key={c.nick}>
                <b>{c.nick}</b> {c.text}
              </li>
            ))}
          </ul>
          <p className="fineprint">게임 속 가상의 발매예요. 실제 음원이 만들어진 것은 아니에요.</p>
        </Modal>
      )}
      {!ui.offlineReport && !ui.concertRun && !cr && !rel && alb && (
        <Modal title="앨범 발매!" onClose={dismissAlbum}>
          <p className="song-title">
            💿 [{alb.def.title}]
          </p>
          <p className="muted">
            {alb.ordinal}번째 앨범 · {alb.def.kind} · {ALBUM_KIND[alb.album.type]} · 수록곡 {alb.def.tracks.length}곡
          </p>
          <ol className="tracklist">
            {alb.def.tracks.map((t, i) => (
              <li key={t.title}>
                <span className="track-no">{i + 1}</span>
                <span className="track-title">{t.title}</span>
                {t.isTitle && <span className="track-tag">Title</span>}
              </li>
            ))}
          </ol>
          <ul className="reward-list">
            <li>
              👥 팬 <b>+{fmt(alb.fans)}</b>
            </li>
            {alb.diamonds > 0 && (
              <li>
                💎 다이아 <b>+{fmt(alb.diamonds)}</b>
              </li>
            )}
            <li>
              📈 인세 배율 <b>+{Math.round(albumRoyaltyOf(alb.ordinal - 1) * 100)}%</b> (누적 +{Math.round(albumRoyaltyBonus(g.albums.length) * 100)}%)
            </li>
          </ul>
        </Modal>
      )}
      {ui.tourCardOpen && !ui.offlineReport && !ui.concertRun && !cr && (
        <Modal title="🏆 첫 투어 완료!" onClose={() => setTourCardOpen(false)} tone="gold">
          <p>방구석에서 시작한 두 자아의 믹스테이프가 소형 공연장까지 닿았어요.</p>
          <ul className="reward-list">
            <li>싱글 {g.singles.length}곡 · 앨범 {g.albums.length}장</li>
            <li>팬 {fmt(Math.floor(g.fans))}명 · Lv.{playerLevel(g.fans)}</li>
          </ul>
          <p className="muted">엔딩이지만 끝은 아니에요. 단콘부터 월클 콘서트까지 더 큰 무대가 기다려요.</p>
        </Modal>
      )}
      {!ui.arcadeRun && !ui.offlineReport && !ui.concertRun && <GachaModal />}
      {!ui.arcadeRun && !ui.offlineReport && !ui.concertRun && !ui.gachaResult && <TowerModal />}
      {ui.settingsOpen && <SettingsSheet />}
      {ui.basisOpen && <BasisModal />}
    </>
  );
}

function OfflineModal() {
  const { offlineReport: r, game } = useUi();
  if (!r) return null;
  return (
    <Modal title="돌아왔어요" onClose={dismissOfflineReport}>
      <p>
        자리를 비운 <b>{fmtDuration(r.elapsedMs)}</b> 동안 모노사파가 작업을 이어갔어요. (효율 {BALANCE.offline.efficiency * 100}%
        {r.capped ? ` · 최대 ${offlineCapMs(game) / 3600000}시간분만 반영` : ''})
      </p>
      <ul className="reward-list">
        <li>
          🪙 코인 <b>+{fmt(Math.floor(r.coins))}</b>
        </li>
        <li>
          일반 라임 <b>+{fmt(Math.floor(r.normalRhymes))}</b>
        </li>
        <li>
          어둠 라임 <b>+{fmt(Math.floor(r.darkRhymes))}</b>
        </li>
        {r.streams >= 1 && (
          <li>
            🎧 스트리밍 <b>+{fmtStreams(r.streams)}</b> <small>(통계 탭에서 정산)</small>
          </li>
        )}
      </ul>
      {r.micSeized && (
        <p className="muted">
          🎤 어둠속성이 과열되어 마이크가 압수됐고, 일반속성으로 돌아와 계속 작업했어요. 재화는 잃지 않았어요.
        </p>
      )}
      <p className="fineprint">보상은 이미 반영됐어요. 오프라인에서는 곡 발매·구매를 자동으로 하지 않아요.</p>
    </Modal>
  );
}

function BasisModal() {
  const { game: g } = useUi();
  const Pn = productionMultiplier(g, 'normal');
  const Pd = productionMultiplier(g, 'dark');
  const persona = g.activePersona;
  const roy = royaltyBreakdown(g);
  const collection = bonuses(g);
  const lv = playerLevel(g.fans);
  const nextFans = BALANCE.level.fansPerStep * lv * lv;
  return (
    <Modal title="계산 근거" onClose={() => setBasisOpen(false)}>
      <dl className="basis">
        <dt>일반속성 생산배율</dt>
        <dd>
          1 + 0.15×마이크 {g.equipment.mic} + 0.05×작업실 {g.equipment.studio} = <b>{Pn.toFixed(2)}</b>
        </dd>
        <dt>어둠속성 생산배율</dt>
        <dd>
          1 + 0.15×마이크 {g.darkEquipment.mic} + 0.05×작업실 {g.darkEquipment.studio} = <b>{Pd.toFixed(2)}</b>
        </dd>
        <dt>작업하기 1회 라임 ({PERSONA_TEXT[persona].short})</dt>
        <dd>
          (1 + {CLICK_POWER_TEXT[persona].name} {clickPowerOf(g, persona)}) × {persona === 'normal' ? '일반' : '어둠'} 생산배율 ={' '}
          <b>{fmtRate(clickGain(g))}</b>
        </dd>
        <dt>일반 라임/초</dt>
        <dd>
          1.0 × 일반 생산배율 = <b>{fmtRate(rhymeRate(g, 'normal'))}</b> (마이크 압수 직후 20초는 50%)
        </dd>
        <dt>어둠 라임/초</dt>
        <dd>
          {g.heat < BALANCE.persona.hotThreshold ? '1.7' : '2.1'} × 어둠 생산배율 = <b>{fmtRate(rhymeRate(g, 'dark'))}</b> (과열 80 이상이면 2.1)
        </dd>
        <dt>다이아 증폭</dt>
        <dd>
          생산 ×{diamondProductionMult(g).toFixed(2)} (자동+작업하기, 두 자아 모두) · 인세 ×{roy.diamondMult.toFixed(2)}
        </dd>
        <dt>수집 보너스</dt>
        <dd>
          라임 +{Math.round(collection.rhyme[persona] * 100)}% ({PERSONA_TEXT[persona].short}) · 인세 +{Math.round(collection.coin * 100)}% · 팬 획득 +{Math.round(collection.fan * 100)}% · 전투력 +{Math.round(collection.power * 100)}% (곡 카드·피처링·포토 세트·마스코트)
        </dd>
        <dt>스트리밍/초</dt>
        <dd>
          팬 {fmtHave(g.fans)} × {BALANCE.streaming.perFanPerSec} = <b>{fmtStreamRate(streamRate(g))}</b> ({BALANCE.streaming.streamsPerCoin}스트리밍 = 코인 1, 통계 탭에서{' '}
          {BALANCE.streaming.claimIntervalMs / 3600000}시간마다 정산)
        </dd>
        <dt>인세 코인/초</dt>
        <dd>
          팬 {fmtHave(roy.fans)} × 0.02 × 홍보({PERSONA_TEXT[persona].short}) {roy.promotionMult.toFixed(2)} × 앨범 {roy.albumMult.toFixed(2)} × 자아 {roy.personaMult} × 다이아 {roy.diamondMult.toFixed(2)} ={' '}
          <b>{fmtRate(roy.perSec)}</b> ({PERSONA_TEXT[persona].short})
        </dd>
        <dt>레벨</dt>
        <dd>
          1 + floor(√(팬/20)) = <b>Lv.{lv}</b> · 다음 레벨은 팬 {fmt(nextFans)}명
        </dd>
        <dt>오프라인</dt>
        <dd>최대 {offlineCapMs(g) / 3600000}시간, 생산·인세 효율 70% (과열 변화는 실제 시간 100%)</dd>
      </dl>
    </Modal>
  );
}

function ReadOnlyScreen() {
  return (
    <div className="center-screen" role="alert">
      <h1>다른 탭에서 실행 중이에요</h1>
      <p>
        모노사파 키우기는 한 번에 한 탭에서만 저장해요. 두 탭이 같은 저장을 덮어쓰는 일을 막기 위해 이 탭은 읽기 전용 안내만 보여줘요.
      </p>
      <button type="button" className="btn btn-primary" onClick={() => void takeOver()}>
        이 탭에서 계속하기
      </button>
      <small className="muted">다른 탭은 진행 상황을 저장한 뒤 읽기 전용으로 바뀌어요.</small>
    </div>
  );
}

function CorruptScreen() {
  const { loadError } = useUi();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="center-screen corrupt" role="alert">
      <h1>저장 데이터를 읽을 수 없어요</h1>
      <p className="muted">{loadError?.message}</p>
      <p>자동으로 덮어쓰지 않았어요. 아래에서 선택해 주세요.</p>
      <div className="btn-col">
        {loadError?.hasBackup && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const r = recoverBackup();
              if (!r.ok) setMsg(r.message);
            }}
          >
            백업에서 복구하기
          </button>
        )}
        <button type="button" className="btn btn-danger" onClick={startNewAfterCorrupt}>
          새 게임 시작 (손상된 저장은 따로 보관)
        </button>
      </div>
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}
