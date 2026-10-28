import { useRef, useState } from 'react';
import { Modal } from '../components/Modal';
import { exportText, importFromText, resetAll, setSettingsOpen, updateSettings, useUi } from '../store/gameStore';

export function SettingsSheet() {
  const { game } = useUi();
  const s = game.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const download = () => {
    const blob = new Blob([exportText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monosapa-save-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('저장 파일을 내보냈어요.');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText());
      setMessage('클립보드에 복사했어요.');
    } catch {
      setMessage('복사에 실패했어요. 「파일로 내보내기」를 사용해 주세요.');
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      setMessage('파일이 너무 커요. (5MB 이하)');
      return;
    }
    const text = await file.text();
    const r = importFromText(text);
    setMessage(r.ok ? null : `불러오기 실패: ${r.message}`);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Modal title="설정" onClose={() => setSettingsOpen(false)}>
      <div className="settings">
        <label className="setting-row">
          <span>
            <strong>소리</strong>
            <small>효과음·공연 비트·배경음악. 첫 입력 이후에만 켜져요.</small>
          </span>
          <input type="checkbox" checked={!s.muted} onChange={(e) => updateSettings({ muted: !e.target.checked })} />
        </label>

        <label className="setting-row">
          <span>
            <strong>배경음악</strong>
            <small>일반·어둠 자아마다 다른 곡이 나와요. 직접 공연 중에는 작게 깔려요.</small>
          </span>
          <input type="checkbox" checked={!s.bgmMuted} disabled={s.muted} onChange={(e) => updateSettings({ bgmMuted: !e.target.checked })} />
        </label>

        <div className="setting-row">
          <span>
            <strong>대사 톤</strong>
            <small>보상·성장 수치는 같고 대사만 바뀌어요.</small>
          </span>
          <div className="seg" role="group" aria-label="대사 톤">
            <button type="button" aria-pressed={s.dialogueTone === 'original'} onClick={() => updateSettings({ dialogueTone: 'original' })}>
              원래 톤
            </button>
            <button type="button" aria-pressed={s.dialogueTone === 'soft'} onClick={() => updateSettings({ dialogueTone: 'soft' })}>
              순화
            </button>
          </div>
        </div>

        <label className="setting-row">
          <span>
            <strong>모션 감소</strong>
            <small>흔들림·펄스·깜빡임을 줄여요.</small>
          </span>
          <input type="checkbox" checked={s.reducedMotion} onChange={(e) => updateSettings({ reducedMotion: e.target.checked })} />
        </label>

        <div className="setting-block">
          <strong>저장 데이터</strong>
          <small>이 기기 브라우저(localStorage)에만 저장돼요. 불러온 파일은 불러온 시점부터 이어서 진행되며 오프라인 보상은 지급되지 않아요.</small>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={download}>
              파일로 내보내기
            </button>
            <button type="button" className="btn btn-ghost" onClick={copy}>
              복사
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              파일 불러오기
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          {message && (
            <p className="muted" role="status">
              {message}
            </p>
          )}
        </div>

        <div className="setting-block danger">
          <strong>초기화</strong>
          {!confirmReset ? (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(true)}>
              처음부터 다시 시작…
            </button>
          ) : (
            <>
              <small>곡·앨범·장비·공연 기록이 모두 사라지고 새 게임이 시작돼요. 직전 저장은 백업으로 한 번 남겨둬요.</small>
              <div className="btn-row">
                <button type="button" className="btn btn-danger" onClick={resetAll}>
                  정말 초기화
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
                  취소
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
