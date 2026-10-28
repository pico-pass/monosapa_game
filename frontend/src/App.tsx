import { useEffect, useRef, useState } from 'react';
import { bgm } from './audio/bgm';
import { Modal } from './components/Modal';
import { PersonaBadge } from './components/parts';
import { fmt, fmtDuration, fmtHave, fmtRate } from './components/format';
import { BALANCE } from './game/balance';
import { PERSONA_TEXT, STAGE_TEXT } from './game/content';
import {
  albumRoyaltyBonus,
  albumRoyaltyOf,
  playerLevel,
  productionMultiplier,
  rhymeRate,
  royaltyBreakdown,
} from './game/selectors';
import { CollectionScreen } from './screens/CollectionScreen';
import { ConcertScreen } from './screens/ConcertScreen';
import { ConcertStage } from './screens/ConcertStage';
import { EquipScreen } from './screens/EquipScreen';
import { ReleaseScreen } from './screens/ReleaseScreen';
import { SettingsSheet } from './screens/SettingsSheet';
import { StudioScreen } from './screens/StudioScreen';
import {
  boot,
  dismissAlbum,
  dismissOfflineReport,
  dismissRelease,
  closeConcertResult,
  importFromText,
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

const ALBUM_KIND = { normal: '일반', dark: '어둠' } as const;

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'studio', label: '작업실', icon: '🎙️' },
  { id: 'release', label: '발매', icon: '💿' },
  { id: 'equip', label: '장비', icon: '🎛️' },
  { id: 'concert', label: '공연', icon: '🎪' },
  { id: 'collection', label: '도감', icon: '📚' },
];

export function App() {
  const ui = useUi();

  useEffect(() => {
    void boot();
  }, []);

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
  const ducked = !!ui.concertRun;

  // 배경음악: 자아가 바뀌면 곡이 교차 페이드되고, 직접 공연 중에는 작아진다.
  useEffect(() => {
    bgm.configure({ persona, muted, bgmMuted, ducked });
  }, [persona, muted, bgmMuted, ducked]);

  return (
    <div className={`app${g.settings.reducedMotion ? 'reduce-motion' : ''}`} data-persona={persona}>
      <TopBar />
      {ui.saveError && (
        <div className="banner banner-warn" role="alert">
          저장 문제: {ui.saveError}
        </div>
      )}
      <main className="main" id="main">
        {ui.tab === 'studio' && <StudioScreen />}
        {ui.tab === 'release' && <ReleaseScreen />}
        {ui.tab === 'equip' && <EquipScreen />}
        {ui.tab === 'concert' && <ConcertScreen />}
        {ui.tab === 'collection' && <CollectionScreen />}
      </main>
      <nav className="tabs" aria-label="메인 메뉴">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${ui.tab === t.id ? 'tab-on' : ''}`} aria-current={ui.tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
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
      <button type="button" className="resources" onClick={() => setBasisOpen(true)} aria-label="코인·팬·레벨. 누르면 계산 근거를 봅니다">
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
      {ui.settingsOpen && <SettingsSheet />}
      {ui.basisOpen && <BasisModal />}
    </>
  );
}

function OfflineModal() {
  const r = useUi().offlineReport!;
  return (
    <Modal title="돌아왔어요" onClose={dismissOfflineReport}>
      <p>
        자리를 비운 <b>{fmtDuration(r.elapsedMs)}</b> 동안 모노사파가 작업을 이어갔어요. (효율 {BALANCE.offline.efficiency * 100}%
        {r.capped ? ` · 최대 ${BALANCE.offline.capMs / 3600000}시간분만 반영` : ''})
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
  const P = productionMultiplier(g);
  const roy = royaltyBreakdown(g);
  const lv = playerLevel(g.fans);
  const nextFans = BALANCE.level.fansPerStep * lv * lv;
  return (
    <Modal title="계산 근거" onClose={() => setBasisOpen(false)}>
      <dl className="basis">
        <dt>생산배율 P</dt>
        <dd>
          1 + 0.15×마이크 {g.equipment.mic} + 0.10×작업실 {g.equipment.studio} = <b>{P.toFixed(2)}</b>
        </dd>
        <dt>일반 라임/초</dt>
        <dd>
          1.0 × P = <b>{fmtRate(rhymeRate(g, 'normal'))}</b> (마이크 압수 직후 20초는 50%)
        </dd>
        <dt>어둠 라임/초</dt>
        <dd>
          {g.heat < BALANCE.persona.hotThreshold ? '1.7' : '2.1'} × P = <b>{fmtRate(rhymeRate(g, 'dark'))}</b> (과열 80 이상이면 2.1)
        </dd>
        <dt>인세 코인/초</dt>
        <dd>
          팬 {fmtHave(roy.fans)} × 0.02 × 홍보 {roy.promotionMult.toFixed(2)} × 앨범 {roy.albumMult.toFixed(2)} × 자아 {roy.personaMult} ={' '}
          <b>{fmtRate(roy.perSec)}</b> ({PERSONA_TEXT[g.activePersona].short})
        </dd>
        <dt>레벨</dt>
        <dd>
          1 + floor(√(팬/20)) = <b>Lv.{lv}</b> · 다음 레벨은 팬 {fmt(nextFans)}명
        </dd>
        <dt>오프라인</dt>
        <dd>최대 2시간, 생산·인세 효율 70% (과열 변화는 실제 시간 100%)</dd>
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
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
        <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
          저장 파일 불러오기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = importFromText(await f.text());
            if (!r.ok) setMsg(`불러오기 실패: ${r.message}`);
          }}
        />
        <textarea className="paste" rows={3} placeholder="저장 JSON을 붙여넣을 수도 있어요" value={text} onChange={(e) => setText(e.target.value)} />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!text.trim()}
          onClick={() => {
            const r = importFromText(text);
            if (!r.ok) setMsg(`불러오기 실패: ${r.message}`);
          }}
        >
          붙여넣은 내용 불러오기
        </button>
        <button type="button" className="btn btn-danger" onClick={startNewAfterCorrupt}>
          새 게임 시작 (손상된 저장은 따로 보관)
        </button>
      </div>
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}
