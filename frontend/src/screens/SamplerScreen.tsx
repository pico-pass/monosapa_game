import { useEffect, useRef, useState } from 'react';
import { BPM_RANGE, Looper, PAD_RATES, SAMPLE_MS, STEPS, defaultPattern, getSample, isWorkSfx, playSample, recordSample, setSample, type Pattern, type Sample } from '../audio/sampler';
import { deleteSample, saveSample, writeWorkSfx } from '../platform/sampler';
import { useAuth } from '../store/authStore';
import { toast } from '../store/gameStore';

const PAD_NAMES = ['낮게', '원음', '높게', '더 높게'];

/** 내 목소리 샘플러: 3초를 녹음해서 패드와 8스텝 비트로 써요. 녹음은 이 기기 안에만 있어요. */
export function SamplerScreen() {
  const account = useAuth().user?.id ?? 'guest';
  const [sample, setLocal] = useState<Sample | null>(() => getSample());
  const [recording, setRecording] = useState(false);
  const [pattern, setPattern] = useState<Pattern>(() => defaultPattern());
  const [bpm, setBpm] = useState<number>(BPM_RANGE.default);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [workSfx, setWork] = useState(() => isWorkSfx());
  const looper = useRef(new Looper());
  const patternRef = useRef(pattern);
  const bpmRef = useRef(bpm);
  patternRef.current = pattern;
  bpmRef.current = bpm;

  useEffect(() => {
    const l = looper.current;
    return () => l.stop();
  }, []);

  const record = async () => {
    setRecording(true);
    try {
      const s = await recordSample();
      setSample(s);
      setLocal(s);
      await saveSample(account, s);
      toast('🎙️ 녹음했어요!', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : '녹음하지 못했어요.', 'warn');
    }
    setRecording(false);
  };

  const togglePlay = () => {
    if (looper.current.running) {
      looper.current.stop();
      setPlaying(false);
      setStep(-1);
      return;
    }
    const ok = looper.current.start(
      () => bpmRef.current,
      () => patternRef.current,
      setStep,
    );
    if (!ok) toast('먼저 화면을 한 번 눌러 소리를 켜 주세요.', 'warn');
    setPlaying(ok);
  };

  const remove = async () => {
    looper.current.stop();
    setPlaying(false);
    setStep(-1);
    setSample(null);
    setLocal(null);
    writeWorkSfx(account, false);
    setWork(false);
    await deleteSample(account);
  };

  return (
    <section className="screen" aria-label="목소리 샘플러">
      <h2 className="section-title">내 목소리 샘플러</h2>
      <p className="muted">마이크로 {SAMPLE_MS / 1000}초를 녹음하면 패드와 비트로 쓸 수 있어요. 녹음은 이 기기 안에서만 처리·저장되고 서버나 게임 저장에는 올라가지 않아요.</p>
      <div className="card">
        <button type="button" className="btn btn-primary btn-wide" disabled={recording} onClick={() => void record()}>
          {recording ? `🔴 녹음 중… ${SAMPLE_MS / 1000}초` : sample ? '🎙️ 다시 녹음하기' : '🎙️ 녹음하기'}
        </button>
        <small className="fineprint">처음에는 브라우저가 마이크 사용을 물어봐요. 조용한 곳에서 짧게 한마디 해 보세요.</small>
      </div>

      {sample && (
        <>
          <div className="card">
            <h3>패드</h3>
            <div className="sampler-pads">
              {PAD_RATES.map((rate, i) => (
                <button key={rate} type="button" className="sampler-pad" onPointerDown={() => playSample(rate)}>
                  <strong>{PAD_NAMES[i]}</strong>
                  <small>×{rate}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-row">
              <h3>비트 {STEPS}스텝</h3>
              <button type="button" className="btn btn-primary" onClick={togglePlay}>
                {playing ? '■ 멈춤' : '▶ 재생'}
              </button>
            </div>
            <div className="sampler-grid" role="group" aria-label="비트 패턴">
              {pattern.map((row, pad) => (
                <div key={pad} className="sampler-row">
                  {row.map((on, s) => (
                    <button
                      key={s}
                      type="button"
                      className={`sampler-step${on ? ' sampler-on' : ''}${step === s ? ' sampler-now' : ''}`}
                      aria-pressed={on}
                      aria-label={`${PAD_NAMES[pad]} ${s + 1}번째 칸`}
                      onClick={() => setPattern(pattern.map((r, p) => (p === pad ? r.map((v, k) => (k === s ? !v : v)) : r)))}
                    />
                  ))}
                </div>
              ))}
            </div>
            <label className="field">
              <small className="muted">빠르기 {bpm} BPM</small>
              <input type="range" min={BPM_RANGE.min} max={BPM_RANGE.max} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
            </label>
          </div>

          <div className="card">
            <label className="setting-row">
              <span>작업하기 효과음으로 쓰기</span>
              <input
                type="checkbox"
                checked={workSfx}
                onChange={(e) => {
                  writeWorkSfx(account, e.target.checked);
                  setWork(e.target.checked);
                }}
              />
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => void remove()}>
              녹음 지우기
            </button>
          </div>
        </>
      )}
    </section>
  );
}
