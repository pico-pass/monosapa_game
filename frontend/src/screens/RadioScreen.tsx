import { useState } from 'react';
import { Modal } from '../components/Modal';
import { fmt, fmtStreams } from '../components/format';
import { BALANCE, featDefById } from '../game/balance';
import { FEAT_RARITY_NAME, FEAT_TEXT, PERSONA_TEXT, RADIO_KIND_TEXT, RADIO_NOTE_TEXT, RADIO_PERIOD_TEXT, RADIO_TEXT } from '../game/content';
import { songCardOf } from '../game/packdata';
import { radioDay, radioPending, radioUnlocked, type RadioHour } from '../game/radio';
import type { GameState, RadioSlot } from '../game/types';
import { doAutoRadio, doClaimRadio, doClearRadio, doSetRadioSlot, useUi } from '../store/gameStore';

const R = BALANCE.radio;
const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;
const hh = (h: number): string => `${String(h).padStart(2, '0')}:00`;

/** 칸 이름: 곡이면 곡 제목, 게스트면 래퍼 이름 */
function slotName(g: GameState, h: RadioHour, slot: RadioSlot): string {
  const kind = RADIO_KIND_TEXT[slot.k];
  if (slot.k === 'song') {
    const single = g.singles.find((x) => x.id === slot.id);
    return `${kind.icon} ${single ? single.title : '(없는 곡)'}`;
  }
  if (slot.k === 'guest') return `${kind.icon} ${slot.id ? (FEAT_TEXT[slot.id]?.name ?? slot.id) : kind.name}`;
  return `${kind.icon} ${kind.name}${h.kind === 'off' && slot.k !== 'off' ? ' (비어 있음)' : ''}`;
}

/** 라디오국 「모노사파 FM」: 24시간 편성표를 짜 두고 지난 방송을 정산해요. */
export function RadioScreen() {
  const { game: g } = useUi();
  const [pick, setPick] = useState<number | null>(null);
  if (!radioUnlocked(g.fans)) {
    return (
      <section className="screen" aria-label="라디오국">
        <h2 className="section-title">{RADIO_TEXT.name}</h2>
        <p className="muted">
          팬이 {fmtStreams(R.unlockFans)}명이 되면 나만의 라디오국이 열려요. (지금 {fmtStreams(g.fans)}명)
        </p>
      </section>
    );
  }
  const day = radioDay(g);
  const pending = radioPending(g);
  const nowHour = new Date(g.lastSettledAt).getHours();
  const minutes = Math.round(day.coinSecs / 60);

  return (
    <section className="screen" aria-label="라디오국">
      <h2 className="section-title">
        <span aria-hidden>{RADIO_TEXT.icon}</span> {RADIO_TEXT.name}
      </h2>
      <p className="muted">{RADIO_TEXT.blurb}</p>

      <div className="card">
        <div className="card-row">
          <strong>정산 대기 {pending.hours}시간</strong>
          <small className="muted">최대 {R.capHours}시간까지 쌓여요</small>
        </div>
        <p>
          🪙 +{fmt(pending.coins)} · 팬 +{fmt(pending.fans)}
        </p>
        <button type="button" className="btn btn-primary btn-wide" disabled={pending.hours === 0} onClick={() => doClaimRadio()}>
          {pending.hours === 0 ? '한 시간이 다 지나면 받을 수 있어요' : '방송 정산 받기'}
        </button>
        <small className="muted">한 시간이 완전히 지난 방송만 정산돼요. 편성을 바꾸면 그때까지의 방송분은 먼저 정산돼요.</small>
      </div>

      <div className="card">
        <div className="card-row">
          <strong>하루 예상</strong>
          <small className="muted">변수 ±{Math.round(R.noise * 100)}% 제외</small>
        </div>
        <p>
          🪙 {fmt(day.coins)} (인세 약 {minutes}분 분량) · 팬 +{pct(day.fansPct)}
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-accent" disabled={g.singles.length === 0} onClick={() => doAutoRadio()}>
            자동 편성
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => doClearRadio()}>
            모두 비우기
          </button>
        </div>
        {g.singles.length === 0 && <small className="muted">첫 싱글을 발매하면 곡을 편성할 수 있어요.</small>}
      </div>

      <h3 className="sub-title">24시간 편성표</h3>
      <div className="radio-list" role="group" aria-label="24시간 편성표">
        {day.hours.map((x, h) => {
          const slot = g.radio.slots[h] ?? { k: 'off' as const };
          const period = RADIO_PERIOD_TEXT[x.period];
          const earns = x.coins > 0 || x.fansPct > 0;
          return (
            <button
              key={h}
              type="button"
              className={`radio-row radio-p-${x.period} ${h === nowHour ? 'radio-row-now' : ''}`}
              aria-label={`${hh(h)} ${slotName(g, x, slot)} 편성 바꾸기`}
              onClick={() => setPick(h)}
            >
              <span className="radio-hour">
                <span aria-hidden>{period.icon}</span> {hh(h)}
                {h === nowHour && <small> 지금</small>}
              </span>
              <span className="radio-main">
                <strong>{slotName(g, x, slot)}</strong>
                {x.notes.length > 0 && (
                  <span className="radio-notes">
                    {x.notes.map((n) => (
                      <span key={n} className={`radio-note radio-note-${RADIO_NOTE_TEXT[n].tone}`}>
                        {RADIO_NOTE_TEXT[n].text}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="radio-yield">
                {x.kind !== 'off' && <span>👥 {fmt(x.listeners)}</span>}
                {earns && (
                  <small>
                    {x.coins > 0 ? `🪙 ${fmt(x.coins)}` : ''}
                    {x.coins > 0 && x.fansPct > 0 ? ' · ' : ''}
                    {x.fansPct > 0 ? `팬 +${pct(x.fansPct)}` : ''}
                  </small>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <p className="fineprint">
        시간대마다 청취자가 달라요(출근·퇴근·밤 22시가 많아요). 낮(07~18시)에는 일반 곡이, 밤(22~05시)에는 어둠 곡이 {Math.round((R.taste.day.normal - 1) * 100)}~{Math.round((R.taste.night.dark - 1) * 100)}% 더 잘 들려요.
        같은 곡을 {R.fatigue.window}칸 안에 또 틀면 −{Math.round((1 - R.fatigue.mult) * 100)}%, 자아가 바뀔 땐 사이에 멘트나 게스트를 넣어요. 광고는 코인을 바로 벌지만 다음 시간 청취자가 줄어요.
      </p>

      {pick !== null && <SlotPicker g={g} hour={pick} onClose={() => setPick(null)} />}
    </section>
  );
}

/** 한 칸을 고르는 창: 곡·멘트·광고·게스트·비움 */
function SlotPicker({ g, hour, onClose }: { g: GameState; hour: number; onClose: () => void }) {
  const current = g.radio.slots[hour] ?? { k: 'off' as const };
  const choose = (slot: RadioSlot): void => {
    doSetRadioSlot(hour, slot);
    onClose();
  };
  const songs = g.singles
    .map((x) => ({ single: x, card: songCardOf(g.cards, x) }))
    .sort((a, b) => R.quality[b.card.rarity] * (1 + R.remaster * b.card.remaster) - R.quality[a.card.rarity] * (1 + R.remaster * a.card.remaster) || (a.single.id < b.single.id ? -1 : 1));
  const usedGuests = new Set(g.radio.slots.flatMap((x, i) => (i !== hour && x.k === 'guest' && x.id ? [x.id] : [])));
  const guests = Object.keys(g.feat.owned)
    .filter((id) => (g.feat.owned[id] ?? 0) > 0 && featDefById(id))
    .sort((a, b) => R.guest[featDefById(b)!.rarity] - R.guest[featDefById(a)!.rarity] || (a < b ? -1 : 1));
  const selected = (slot: RadioSlot): boolean => current.k === slot.k && current.id === slot.id;

  return (
    <Modal title={`${hh(hour)} 편성`} onClose={onClose}>
      <div className="radio-pick-list">
        {(['talk', 'ad', 'off'] as const).map((k) => (
          <button key={k} type="button" className={`radio-pick ${selected({ k }) ? 'radio-pick-on' : ''}`} aria-pressed={selected({ k })} onClick={() => choose({ k })}>
            <strong>
              {RADIO_KIND_TEXT[k].icon} {RADIO_KIND_TEXT[k].name}
            </strong>
            <small className="muted">{RADIO_KIND_TEXT[k].desc}</small>
          </button>
        ))}
        {guests.map((id) => {
          const def = featDefById(id)!;
          const used = usedGuests.has(id);
          const slot: RadioSlot = { k: 'guest', id };
          return (
            <button key={id} type="button" className={`radio-pick ${selected(slot) ? 'radio-pick-on' : ''}`} disabled={used} aria-pressed={selected(slot)} onClick={() => choose(slot)}>
              <strong>
                {RADIO_KIND_TEXT.guest.icon} {FEAT_TEXT[id]?.icon} {FEAT_TEXT[id]?.name ?? id}
              </strong>
              <small className="muted">
                {FEAT_RARITY_NAME[def.rarity]} · 이웃 곡 +{Math.round(R.guest[def.rarity] * 100)}%{used ? ' · 이미 다른 칸에 있어요' : ''}
              </small>
            </button>
          );
        })}
        {songs.map(({ single, card }) => {
          const slot: RadioSlot = { k: 'song', id: single.id };
          return (
            <button key={single.id} type="button" className={`radio-pick ${selected(slot) ? 'radio-pick-on' : ''}`} aria-pressed={selected(slot)} onClick={() => choose(slot)}>
              <strong>
                {RADIO_KIND_TEXT.song.icon} {single.title}
              </strong>
              <small className="muted">
                {PERSONA_TEXT[single.persona].short} · {card.rarity}
                {card.remaster > 0 ? ` +${card.remaster}` : ''} · 곡 배율 ×{(R.quality[card.rarity] * (1 + R.remaster * card.remaster)).toFixed(2)}
              </small>
            </button>
          );
        })}
        {songs.length === 0 && <p className="empty">아직 발매한 싱글이 없어요.</p>}
      </div>
    </Modal>
  );
}
