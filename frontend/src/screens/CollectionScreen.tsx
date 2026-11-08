import { fmt } from '../components/format';
import { PersonaBadge } from '../components/parts';
import { BALANCE, STAGES } from '../game/balance';
import { ALBUM_CATALOG, PERSONA_TEXT, STAGE_TEXT, albumSeries } from '../game/content';
import { isTourComplete, previewRemaster, stageStatus } from '../game/selectors';
import type { Persona, Single } from '../game/types';
import { doRemasterAlbum, useUi } from '../store/gameStore';

/* 싱글 번호는 자아별로 따로 센다. 앨범은 카탈로그 순서대로 낸다. */

const SINGLE_GROUPS: { persona: Persona; title: string }[] = [
  { persona: 'normal', title: '일반속성 싱글' },
  { persona: 'dark', title: '어둠속성 싱글' },
];

export function CollectionScreen() {
  const { game: g } = useUi();
  const singlesOf = (p: Persona) => g.singles.filter((s) => s.persona === p);
  // 비밀 공연장은 열리기 전에는 도감에도 보이지 않는다.
  const stages = STAGES.filter((d) => stageStatus(g, d.id).visible);
  const clearedStages = stages.filter((d) => g.concerts[d.id].cleared).length;

  return (
    <section className="screen" aria-label="도감">
      <h2 className="section-title">도감</h2>
      <div className="stat-grid">
        <div>
          <strong>{singlesOf('normal').length}</strong>
          <span>일반 싱글</span>
        </div>
        <div>
          <strong>{singlesOf('dark').length}</strong>
          <span>어둠 싱글</span>
        </div>
        <div>
          <strong>
            {g.albums.length}/{ALBUM_CATALOG.length}
          </strong>
          <span>앨범</span>
        </div>
        <div>
          <strong>
            {clearedStages}/{stages.length}
          </strong>
          <span>클리어 공연장</span>
        </div>
      </div>

      {SINGLE_GROUPS.map(({ persona, title }) => (
        <SingleList key={persona} title={title} persona={persona} singles={singlesOf(persona)} />
      ))}
      <AlbumList />

      <h3 className="sub-title">공연 기록</h3>
      <ul className="collection">
        {stages.map((def) => {
          const rec = g.concerts[def.id];
          return (
            <li key={def.id} className="collect">
              <div>
                <strong>{STAGE_TEXT[def.id].name}</strong>
                <small>{rec.cleared ? `클리어${rec.bestScore ? ` · 최고 ${rec.bestScore}점` : ' · 자동 공연'}` : '미클리어'}</small>
              </div>
              <span>{rec.cleared ? '✔' : '—'}</span>
            </li>
          );
        })}
      </ul>
      {isTourComplete(g) && <p className="empty">🏆 첫 투어 완료 — 계속 성장할 수 있어요.</p>}
    </section>
  );
}

function SingleList({ title, persona, singles }: { title: string; persona: Persona; singles: Single[] }) {
  return (
    <>
      <h3 className="sub-title">
        {title} ({singles.length})
      </h3>
      {singles.length === 0 ? (
        <p className="empty">아직 {persona === 'normal' ? '일반' : '어둠'}속성으로 발매한 곡이 없어요.</p>
      ) : (
        <ol className="collection">
          {singles.map((s, i) => {
            return (
              <li key={s.id} className="collect">
                <div>
                  <strong>
                    <PersonaBadge persona={s.persona} /> {s.title}
                  </strong>
                </div>
                <span className="muted">{i + 1}번째</span>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/** 앨범은 속성마다 따로 낸다: 일반·어둠 순서로 각자 위에서부터 채워진다. */
function AlbumList() {
  const { game: g } = useUi();
  return (
    <>
      {(['normal', 'dark'] as const).map((type) => {
        const series = albumSeries(type);
        const next = series.find((d) => !g.albums.some((a) => a.id === d.id));
        return (
          <section key={type} aria-label={`${PERSONA_TEXT[type].short}속성 앨범`}>
            <h3 className="sub-title">
              {PERSONA_TEXT[type].short}속성 앨범 ({g.albums.filter((a) => a.type === type).length}/{series.length})
            </h3>
            <ol className="collection">
              {series.map((def, i) => {
                if (!g.albums.some((a) => a.id === def.id)) {
                  return (
                    <li key={def.id} className="collect collect-locked">
                      <div>
                        <strong>💿 ？？？</strong>
                        <small>{def === next ? '다음에 발매할 앨범이에요.' : '앞 앨범을 먼저 발매해요.'}</small>
                      </div>
                      <span className="muted">{i + 1}번째</span>
                    </li>
                  );
                }
                return (
                  <li key={def.id} className={`collect collect-${def.type}`}>
                    <div>
                      <strong>
                        💿 [{def.title}] · {def.kind}
                      </strong>
                      <ol className="tracklist tracklist-small">
                        {def.tracks.map((t, n) => (
                          <li key={t.title}>
                            <span className="track-no">{n + 1}</span>
                            <span className="track-title">{t.title}</span>
                            {t.isTitle && <span className="track-tag">Title</span>}
                          </li>
                        ))}
                      </ol>
                      <RemasterRow albumId={def.id} />
                    </div>
                    <span className="muted">{i + 1}번째</span>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </>
  );
}

/** 낸 앨범의 리마스터. 단계마다 이 앨범이 주던 인세 배율이 커진다. */
function RemasterRow({ albumId }: { albumId: string }) {
  const { game: g } = useUi();
  const pv = previewRemaster(g, albumId);
  if (!pv) return null;
  const pct = (v: number) => Math.round(v * 1000) / 10;
  return (
    <div className="remaster-row">
      <small>
        🎚️ 리마스터 {'★'.repeat(pv.remaster)}
        {'☆'.repeat(BALANCE.remaster.max - pv.remaster)} · 이 앨범 인세 +{pct(pv.before)}%
        {!pv.maxed && <> → +{pct(pv.after)}%</>}
      </small>
      {pv.maxed ? (
        <small className="muted"> 최대</small>
      ) : (
        <button type="button" className="btn btn-ghost" disabled={!pv.affordable} onClick={() => doRemasterAlbum(albumId)}>
          {pv.affordable ? `리마스터 🪙 ${fmt(pv.cost)}` : `🪙 ${fmt(pv.cost)} 필요`}
        </button>
      )}
    </div>
  );
}
