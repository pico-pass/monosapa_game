import { PersonaBadge, Progress } from '../components/parts';
import { fmt, fmtHave } from '../components/format';
import { ALBUM_CATALOG, PERSONA_TEXT } from '../game/content';
import { albumRoyaltyOf, previewAlbum, previewSingle } from '../game/selectors';
import { doAlbum, doRelease, useUi } from '../store/gameStore';

const ALBUM_KIND = { normal: '일반속성', dark: '어둠속성' } as const;

export function ReleaseScreen() {
  const ui = useUi();
  const g = ui.game;
  const persona = g.activePersona;
  const p = previewSingle(g);
  const missing = Math.max(0, Math.ceil(p.needRhymes - p.haveRhymes));

  return (
    <section className="screen" aria-label="발매">
      <h2 className="section-title">싱글 발매</h2>
      <div className={`card card-${persona}`}>
        <div className="card-row">
          <span className="muted">
            {p.ordinal}번째 싱글 · <PersonaBadge persona={persona} /> {PERSONA_TEXT[persona].name}
          </span>
        </div>
        <p className="song-title">「{p.title}」</p>
        <Progress value={p.haveRhymes} max={p.needRhymes} label="필요 라임 진행도" />
        <div className="card-row">
          <span>
            {PERSONA_TEXT[persona].short} 라임 <b>{fmtHave(p.haveRhymes)}</b> / {fmtHave(p.needRhymes)}
          </span>
          <span className="muted">발매 시 소비</span>
        </div>
        <ul className="reward-list" aria-label="발매 보상">
          <li>
            🪙 코인 <b>+{fmt(p.coins)}</b>
          </li>
          <li>
            👥 팬 <b>+{fmt(p.fans)}</b>
          </li>
        </ul>
        <button type="button" className="btn btn-primary btn-wide" disabled={!p.affordable} onClick={doRelease}>
          {p.affordable ? '발매하기' : `라임 ${fmt(missing)}개 더 필요`}
        </button>
        <p className="fineprint">현재 자아의 라임만 사용해요. 일반·어둠 라임은 따로 보관되고 서로 바꿀 수 없어요. 게임 속 가상의 발매이며 실제 음원은 만들어지지 않아요.</p>
      </div>

      <AlbumRelease />
    </section>
  );
}

function AlbumRelease() {
  const ui = useUi();
  const g = ui.game;
  const pv = previewAlbum(g);
  const total = ALBUM_CATALOG.length;

  if (!pv) {
    return (
      <>
        <h2 className="section-title">앨범 발매</h2>
        <div className="card">
          <p className="empty">준비된 앨범 {total}장을 모두 발매했어요. 발매한 앨범은 도감에서 볼 수 있어요.</p>
        </div>
      </>
    );
  }

  const { def } = pv;
  const missing = Math.max(0, Math.ceil(pv.cost - g.coins));
  return (
    <>
      <h2 className="section-title">앨범 발매</h2>
      <div className="card">
        <div className="card-row">
          <span className="muted">
            {pv.index + 1}/{total}번째 앨범 · {def.kind} · {ALBUM_KIND[def.type]}
          </span>
        </div>
        <p className="song-title">
          💿 [{def.title}]
        </p>
        <ol className="tracklist" aria-label="수록곡">
          {def.tracks.map((t, i) => (
            <li key={t.title}>
              <span className="track-no">{i + 1}</span>
              <span className="track-title">{t.title}</span>
              {t.isTitle && <span className="track-tag">Title</span>}
            </li>
          ))}
        </ol>
        <ul className="reward-list" aria-label="발매 보상">
          <li>
            👥 팬 <b>+{fmt(pv.fans)}</b>
          </li>
          <li>
            📈 인세 배율 <b>+{Math.round(albumRoyaltyOf(pv.index) * 100)}%</b>
          </li>
        </ul>
        <div className="card-row">
          <span>
            발매 비용 <b>🪙 {fmt(pv.cost)}</b>
          </span>
          <span className="muted">정해진 수록곡 그대로 발매돼요</span>
        </div>
        <button type="button" className="btn btn-primary btn-wide" disabled={!pv.affordable} onClick={doAlbum}>
          {pv.affordable ? '앨범 발매하기' : `코인 ${fmt(missing)} 더 필요`}
        </button>
        <p className="fineprint">발매한 싱글과는 별개예요. 게임 속 가상의 발매이며 실제 음원은 만들어지지 않아요.</p>
      </div>
    </>
  );
}
