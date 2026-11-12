import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAUNCH } from '../../../../backend/src/launch/rules';
import { ASSETS } from '../../assets';
import { fmtReward as rewardText } from '../../components/format';
import { createInitialState } from '../../game/persistence';
import { applyMailClaim } from '../../game/serverRewards';
import { HIDE_DAY_MS, enterLaunch, hideForOneDay, readHideUntil, shouldShowLaunchPopup, type LaunchInfo } from '../../platform/launch';
import { LaunchCard } from '../LaunchWelcome';

const html = (el: React.ReactElement): string => renderToString(el).replace(/<!-- -->/g, '');
const NOW = 1_800_000_000_000;

const info = (patch: Partial<LaunchInfo> = {}): LaunchInfo => ({
  launched: true,
  epoch: 1,
  launchedAt: NOW - 1000,
  popup: true,
  starter: { coins: LAUNCH.starter.coins, diamonds: LAUNCH.starter.diamonds },
  granted: false,
  ...patch,
});

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

afterEach(() => vi.unstubAllGlobals());

describe('우편으로 받는 코인', () => {
  const base = createInitialState(NOW);

  it('다이아와 코인을 함께 더하고, 코인 없는 옛 우편은 그대로 동작한다', () => {
    const s = { ...base, coins: 10, diamonds: 7 };
    const r = applyMailClaim(s, 150, 100_000_000);
    expect(r.ok && r.state).toMatchObject({ coins: 100_000_010, diamonds: 157 });
    const old = applyMailClaim(s, 2);
    expect(old.ok && old.state).toMatchObject({ coins: 10, diamonds: 9 });
  });

  it('비정상 코인은 잘라내거나 0으로 본다', () => {
    const s = { ...base, coins: 0 };
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY * -1]) {
      const r = applyMailClaim(s, 0, bad);
      expect(r.ok && r.coins).toBe(0);
    }
    const huge = applyMailClaim(s, 0, 1e18);
    expect(huge.ok && huge.coins).toBeLessThanOrEqual(100_000_000_000);
    const frac = applyMailClaim(s, 0, 12.9);
    expect(frac.ok && frac.coins).toBe(12); // 정수만
  });

  it('우편 보상 문구: 다이아·코인을 한 줄로, 코인이 없으면 다이아만', () => {
    expect(rewardText({ diamonds: 150, coins: 100_000_000 })).toBe('💎 150 · 🪙 100M');
    expect(rewardText({ diamonds: 3 })).toBe('💎 3');
    expect(rewardText({ diamonds: 0, coins: 500_000_000 })).toBe('🪙 500M');
  });
});

describe('환영 팝업을 띄울지', () => {
  it('출시했고 보여 줄 기간이며 숨겨 둔 시간이 지났을 때만 띄운다', () => {
    expect(shouldShowLaunchPopup(info(), 0, NOW)).toBe(true);
    expect(shouldShowLaunchPopup(info({ launched: false }), 0, NOW)).toBe(false); // 초기화 전에는 뜨지 않는다
    expect(shouldShowLaunchPopup(info({ popup: false }), 0, NOW)).toBe(false); // 기간이 지났다
    expect(shouldShowLaunchPopup(null, 0, NOW)).toBe(false);
    expect(shouldShowLaunchPopup(info(), NOW + 1, NOW)).toBe(false); // 하루 동안 보지 않기
    expect(shouldShowLaunchPopup(info(), NOW, NOW)).toBe(true);
  });

  it('「하루 동안 보지 않기」는 계정마다 24시간 기억한다', () => {
    const store = memory();
    expect(readHideUntil(store, 'A')).toBe(0);
    hideForOneDay(store, 'A', NOW);
    expect(readHideUntil(store, 'A')).toBe(NOW + HIDE_DAY_MS);
    expect(readHideUntil(store, 'B')).toBe(0);
    expect(shouldShowLaunchPopup(info(), readHideUntil(store, 'A'), NOW + HIDE_DAY_MS - 1)).toBe(false);
    expect(shouldShowLaunchPopup(info(), readHideUntil(store, 'A'), NOW + HIDE_DAY_MS)).toBe(true);
  });

  it('저장소가 막혀 있어도(없거나 던지면) 멈추지 않는다', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readHideUntil(broken, 'A')).toBe(0);
    expect(() => hideForOneDay(broken, 'A', NOW)).not.toThrow();
    expect(readHideUntil(null, 'A')).toBe(0);
    expect(() => hideForOneDay(null, 'A', NOW)).not.toThrow();
  });

  it('서버 호출이 실패하면 null 이라 팝업이 뜨지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await enterLaunch()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => info() }) as Response));
    expect(await enterLaunch()).toMatchObject({ launched: true, epoch: 1 });
  });
});

describe('환영 팝업 화면', () => {
  const noop = () => undefined;
  const render = (starter = info().starter) => html(createElement(LaunchCard, { starter, onMailbox: noop, onHideDay: noop, onClose: noop }));

  it('일반·어둠 모노사파가 대조되는 배경에 출시 문구와 스타트 패키지를 보여 준다', () => {
    const t = render();
    expect(t).toContain('정식 출시');
    expect(t).toContain('모노사파 키우기');
    expect(t).toContain('일반과 어둠, 두 모노사파');
    expect(t).not.toContain('빛과 어둠');
    expect(t).toContain('launch-side-normal');
    expect(t).toContain('launch-side-dark');
    expect(t).toContain(ASSETS.characters.normal!);
    expect(t).toContain(ASSETS.characters.dark!);
    expect(t).toContain('스타트 패키지');
    expect(t).toContain('🪙 100M');
    expect(t).toContain('💎 150');
  });

  it('우편함 열기·하루 동안 보지 않기·닫기 버튼이 있다', () => {
    const t = render();
    expect(t).toContain('우편함 열기');
    expect(t).toContain('하루 동안 보지 않기');
    expect(t).toContain('닫기');
    expect(t).toContain('role="dialog"');
  });

  it('패키지 수치는 서버가 알려 준 값을 보여 준다', () => {
    const t = render({ coins: 5_000_000, diamonds: 20 });
    expect(t).toContain('🪙 5.00M');
    expect(t).toContain('💎 20');
  });
});
