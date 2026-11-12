import { useEffect, useRef, useState } from 'react';
import { fmt } from '../components/format';
import { ASSETS } from '../assets';
import { browserStore, enterLaunch, hideForOneDay, readHideUntil, shouldShowLaunchPopup, type LaunchInfo } from '../platform/launch';
import { useAuth } from '../store/authStore';
import { setTab, useUi } from '../store/gameStore';
import { refreshSummary } from '../store/socialStore';

/** 환영 팝업의 모습(일반·어둠 모노사파가 대조되는 배경에 출시 문구와 스타트 패키지). 그리기만 한다. */
export function LaunchCard({ starter, onMailbox, onHideDay, onClose }: { starter: LaunchInfo['starter']; onMailbox: () => void; onHideDay: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop launch-backdrop" role="presentation">
      <div className="launch-card" role="dialog" aria-modal="true" aria-label="정식 출시 환영" tabIndex={-1} ref={ref}>
        <div className="launch-stage" aria-hidden>
          <div className="launch-side launch-side-normal">
            <img src={ASSETS.characters.normal ?? undefined} alt="" draggable={false} />
          </div>
          <div className="launch-side launch-side-dark">
            <img src={ASSETS.characters.dark ?? undefined} alt="" draggable={false} />
          </div>
          <span className="launch-vs">VS</span>
        </div>
        <div className="launch-panel">
          <p className="launch-kicker">두 자아의 믹스테이프</p>
          <h2 className="launch-title">
            모노사파 키우기 <em>정식 출시</em>
          </h2>
          <p className="launch-lead">빛과 어둠, 두 모노사파가 새 무대에서 기다려요. 함께해 주셔서 고마워요!</p>
          <div className="launch-pack">
            <b>🎁 스타트 패키지</b>
            <span>
              🪙 {fmt(starter.coins)} · 💎 {starter.diamonds}
            </span>
            <small>모든 팬에게 우편함으로 보냈어요. 「받기」를 눌러 주세요.</small>
          </div>
          <div className="launch-actions">
            <button type="button" className="btn btn-primary" onClick={onMailbox}>
              우편함 열기
            </button>
            <button type="button" className="btn btn-ghost" onClick={onHideDay}>
              하루 동안 보지 않기
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 게임에 들어오면 서버에 출시 상태를 물어보고, 출시 기간이면 환영 팝업을 띄운다. */
export function LaunchWelcome() {
  const auth = useAuth();
  const ui = useUi();
  const uid = auth.user?.id ?? '';
  const [info, setInfo] = useState<LaunchInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void enterLaunch().then((res) => {
      if (!alive || !res) return;
      if (res.granted) void refreshSummary(); // 방금 온 스타트 패키지 우편을 알림에 반영한다
      setInfo(res);
      if (shouldShowLaunchPopup(res, readHideUntil(browserStore(), uid), Date.now())) setOpen(true);
    });
    return () => {
      alive = false;
    };
  }, [uid]);

  // 게임 화면(공연·아케이드·계단)이나 오프라인 결과 위에는 띄우지 않고, 끝난 뒤에 보여 준다.
  if (!open || !info || ui.concertRun || ui.arcadeRun || ui.towerRun || ui.offlineReport) return null;
  return (
    <LaunchCard
      starter={info.starter}
      onClose={() => setOpen(false)}
      onHideDay={() => {
        hideForOneDay(browserStore(), uid, Date.now());
        setOpen(false);
      }}
      onMailbox={() => {
        setTab('postbox');
        setOpen(false);
      }}
    />
  );
}
