import { useState } from 'react';
import { api, errorText } from '../platform/api';
import { closeReport, type ReportTarget } from '../store/socialStore';
import { toast } from '../store/gameStore';
import { Modal } from './Modal';

export const REPORT_REASONS = [
  ['abuse', '욕설·비방'],
  ['spam', '도배·광고'],
  ['sexual', '음란·불쾌한 내용'],
  ['hate', '혐오·차별'],
  ['other', '기타'],
] as const;
type Reason = (typeof REPORT_REASONS)[number][0];

const KIND_TEXT: Record<ReportTarget['kind'], string> = { chat: '챗방 메시지', dm: '개인채팅 메시지', profile: '프로필' };
const DETAIL_MAX = 200;

/** 챗방 메시지·개인채팅 메시지·프로필 신고. 운영자가 확인해 처리하고, 결과는 우편으로 알려 줘요. */
export function ReportDialog({ target }: { target: ReportTarget }) {
  const [reason, setReason] = useState<Reason>('abuse');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('reports', { method: 'POST', body: { kind: target.kind, refId: target.refId, uid: target.uid, reason, detail } });
      toast('🚩 신고가 접수됐어요. 운영자가 확인하고 결과를 우편으로 알려 드려요.', 'good');
      closeReport();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="신고하기"
      onClose={closeReport}
      footer={
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={closeReport}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? '보내는 중…' : '신고 보내기'}
          </button>
        </div>
      }
    >
      <p>
        <b>{target.label}</b>님의 {KIND_TEXT[target.kind]}를 신고해요.
      </p>
      <label className="field">
        <span>사유</span>
        <select value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
          {REPORT_REASONS.map(([id, text]) => (
            <option key={id} value={id}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>
          자세한 설명 (선택, {detail.length}/{DETAIL_MAX})
        </span>
        <textarea value={detail} rows={3} maxLength={DETAIL_MAX} onChange={(e) => setDetail(e.target.value)} placeholder="운영자가 알아야 할 내용을 적어 주세요" />
      </label>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <small className="fineprint">
        {target.kind === 'dm' ? '개인채팅은 신고한 메시지와 앞선 대화 몇 줄만 운영자에게 전달돼요. ' : ''}허위 신고를 반복하면 이용이 제한될 수 있어요.
      </small>
    </Modal>
  );
}
