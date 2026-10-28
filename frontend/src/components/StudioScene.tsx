import { ASSETS } from '../assets';
import { PERSONA_TEXT } from '../game/content';
import type { Persona } from '../game/types';

export type Mood = 'idle' | 'work' | 'hot' | 'seized';

interface Props {
  persona: Persona;
  mood: Mood;
  /** 작업실 레벨 기반 외형 단계 0~4 */
  tier: number;
  /** 작업 입력이 들어올 때마다 바뀌는 값: 키가 바뀌면 애니메이션이 다시 재생된다. */
  pulse: number;
}

/** 임시 SVG 작업실 + 캐릭터. assets/index.ts에 이미지 경로를 넣으면 해당 부분이 교체된다. */
export function StudioScene({ persona, mood, tier, pulse }: Props) {
  const dark = persona === 'dark';
  const roomImg = ASSETS.rooms[persona];
  const charImg = ASSETS.characters[persona];
  const text = PERSONA_TEXT[persona];

  return (
    <svg
      className="scene"
      data-persona={persona}
      data-mood={mood}
      viewBox="0 8 360 284"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`${text.name} 모노사파의 작업실. 표정: ${moodLabel(mood)}`}
    >
      <defs>
        <radialGradient id="glow-normal" cx="50%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#fff3d6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#8ea4d8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="glow-dark" cx="50%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#ff2e5f" stopOpacity="0.4" />
          <stop offset="55%" stopColor="#7a1fb8" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.45" />
        </radialGradient>
      </defs>

      {roomImg ? (
        <image href={roomImg} x="0" y="0" width="360" height="300" preserveAspectRatio="xMidYMid slice" />
      ) : (
        <Room dark={dark} tier={tier} posterTitle={text.poster} posterSub={text.sub} />
      )}

      <g key={pulse} className={`char ${mood === 'work' ? 'char-work' : ''}`}>
        {charImg ? (
          <g className="char-body">
            <image href={charImg} x="45" y="26" width="270" height="270" preserveAspectRatio="xMidYMax meet" />
            {mood === 'hot' && (
              <g fill="#7fd4ff" className="sweat">
                <path d="M232 96 q7 12 0 17 q-7 -5 0 -17 Z" />
                <path d="M132 110 q6 10 0 14 q-6 -4 0 -14 Z" />
              </g>
            )}
            {mood === 'seized' && (
              <text x="246" y="96" className="ellipsis">
                …
              </text>
            )}
          </g>
        ) : (
          <Character dark={dark} mood={mood} />
        )}
      </g>

      <Desk dark={dark} tier={tier} />
      <rect width="360" height="300" fill={`url(#glow-${persona})`} pointerEvents="none" />
    </svg>
  );
}

function moodLabel(m: Mood): string {
  return m === 'work' ? '작업 중' : m === 'hot' ? '과열' : m === 'seized' ? '마이크 압수' : '대기';
}

/* ---------- 방 ---------- */

function Room({ dark, tier, posterTitle, posterSub }: { dark: boolean; tier: number; posterTitle: string; posterSub: string }) {
  return (
    <g>
      <rect width="360" height="222" fill="var(--wall)" />
      <rect y="222" width="360" height="78" fill="var(--floor)" />
      <rect y="218" width="360" height="6" fill="var(--baseboard)" />

      {/* 창문 */}
      <g transform="translate(246 26)">
        <rect width="84" height="92" rx="4" fill="var(--window)" stroke="var(--frame)" strokeWidth="5" />
        {dark ? (
          <g stroke="#ff2e5f" strokeWidth="3" opacity="0.8">
            {[14, 30, 46, 62, 78].map((y) => (
              <line key={y} x1="2" y1={y} x2="82" y2={y} />
            ))}
          </g>
        ) : (
          <g fill="#fff8d6">
            <circle cx="58" cy="26" r="11" />
            <circle cx="64" cy="22" r="10" fill="var(--window)" />
            <circle cx="20" cy="60" r="1.6" />
            <circle cx="36" cy="40" r="1.2" />
            <circle cx="66" cy="68" r="1.6" />
          </g>
        )}
        <line x1="42" y1="0" x2="42" y2="92" stroke="var(--frame)" strokeWidth="3" />
      </g>

      {/* 공연 포스터 */}
      <g transform="translate(20 24) rotate(-3)">
        <rect width="78" height="100" rx="3" fill="var(--poster)" stroke="var(--frame)" strokeWidth="2" />
        <circle cx="39" cy="34" r="16" fill="var(--poster-accent)" opacity="0.9" />
        <rect x="31" y="26" width="16" height="22" rx="8" fill="var(--poster)" />
        <text x="39" y="72" textAnchor="middle" className="poster-title">
          {posterTitle}
        </text>
        <text x="39" y="87" textAnchor="middle" className="poster-sub">
          {posterSub.split(' · ')[0]}
        </text>
        <rect x="-4" y="-4" width="12" height="12" rx="2" fill="#f5d36b" opacity="0.8" transform="rotate(14)" />
      </g>

      {/* 구겨진 가사 종이 */}
      <g>
        <g transform="translate(112 40) rotate(6)">
          <path d="M0 0 L38 -2 L40 30 L2 32 Z" fill="var(--paper)" stroke="#0003" />
          <path d="M6 8h26M6 14h22M6 20h26M6 26h14" stroke={dark ? '#b3123a' : '#6e7aa5'} strokeWidth="1.4" />
        </g>
        {dark && (
          <g transform="translate(150 150)" fill="none" stroke="#ff2e5f" strokeWidth="2" opacity="0.7">
            <path d="M0 0 l8 -10 l6 12 l8 -14 l6 14" />
          </g>
        )}
      </g>

      {/* 외형 단계(작업실 레벨 5마다 변화) */}
      {tier >= 1 && (
        <g>
          <path d="M0 8 Q90 34 180 10 T360 14" stroke="#0006" fill="none" strokeWidth="1.5" />
          {[18, 56, 94, 132, 170, 208, 246, 284, 322].map((x, i) => (
            <circle
              key={x}
              cx={x}
              cy={i % 2 ? 22 : 17 + (x < 180 ? i : 8 - i / 2)}
              r="3.6"
              fill={dark ? (i % 2 ? '#ff2e5f' : '#b061ff') : i % 2 ? '#ffd27a' : '#9fd0ff'}
              className="string-light"
            />
          ))}
        </g>
      )}
      {tier >= 2 && (
        <g transform="translate(184 36) rotate(4)">
          <rect width="50" height="64" rx="3" fill="var(--poster)" stroke="var(--frame)" strokeWidth="2" />
          <path d="M8 44 Q25 14 42 44" stroke="var(--poster-accent)" strokeWidth="5" fill="none" />
          <text x="25" y="58" textAnchor="middle" className="poster-sub">
            TOUR
          </text>
        </g>
      )}
      {tier >= 3 && (
        <g transform="translate(112 94)">
          <rect x="-4" y="-14" width="76" height="26" rx="6" fill="#0007" />
          <text x="34" y="5" textAnchor="middle" className="neon">
            MONO
          </text>
        </g>
      )}
      {tier >= 4 && (
        <g>
          <g transform="translate(6 150)">
            <rect width="34" height="62" rx="4" fill="#15131c" stroke="#fff3" />
            <circle cx="17" cy="40" r="11" fill="#2a2536" stroke="#fff4" />
            <circle cx="17" cy="14" r="5" fill="#2a2536" stroke="#fff4" />
          </g>
          <g transform="translate(322 150)">
            <rect width="34" height="62" rx="4" fill="#15131c" stroke="#fff3" />
            <circle cx="17" cy="40" r="11" fill="#2a2536" stroke="#fff4" />
            <circle cx="17" cy="14" r="5" fill="#2a2536" stroke="#fff4" />
          </g>
          <g transform="translate(60 138)">
            <circle r="16" fill="#e8c14e" stroke="#fff6" />
            <circle r="4" fill="#3b2f0a" />
          </g>
        </g>
      )}

      {/* 바닥: 일반은 정돈된 방, 어둠은 어질러진 방 */}
      {dark ? (
        <g fill="var(--paper)" stroke="#0003">
          <circle cx="48" cy="262" r="9" />
          <circle cx="78" cy="278" r="7" />
          <circle cx="300" cy="266" r="8" />
          <circle cx="330" cy="284" r="9" />
          <circle cx="262" cy="288" r="6" />
          <path d="M120 285 l14 -6 l6 12 z" />
        </g>
      ) : (
        <g>
          <rect x="304" y="236" width="14" height="22" rx="3" fill="#8a6a50" />
          <path d="M311 236 q-14 -22 -6 -34 M311 236 q10 -20 20 -22 M311 236 q2 -26 -2 -34" stroke="#59a46f" strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
      )}
    </g>
  );
}

/* ---------- 책상 ---------- */

function Desk({ dark, tier }: { dark: boolean; tier: number }) {
  return (
    <g>
      <rect y="236" width="360" height="14" rx="2" fill="var(--desk-top)" />
      <rect y="250" width="360" height="50" fill="var(--desk)" />
      {/* 노트북 */}
      <g transform="translate(36 190)">
        <path d="M0 46 L10 0 L70 0 L80 46 Z" fill="#17151e" stroke="#fff3" />
        <path d="M14 8 L66 8 L72 40 L8 40 Z" fill={dark ? '#3a0f2a' : '#2f4375'} />
        <path d="M18 16h30M18 22h38M18 28h22" stroke={dark ? '#ff6b8f' : '#9ec1ff'} strokeWidth="2" opacity="0.9" />
      </g>
      {/* 믹서 */}
      <g transform="translate(262 214)">
        <rect width="64" height="22" rx="3" fill="#1c1a25" stroke="#fff3" />
        {[8, 20, 32, 44].map((x, i) => (
          <g key={x}>
            <rect x={x} y="4" width="2.4" height="14" fill="#fff4" />
            <rect x={x - 2} y={6 + ((i * 5) % 8)} width="6.4" height="3" fill={dark ? '#ff2e5f' : '#9fd0ff'} />
          </g>
        ))}
      </g>
      {/* 머그컵 */}
      <g transform="translate(126 222)">
        <rect width="16" height="14" rx="3" fill={dark ? '#6b1b3f' : '#e7e2f4'} />
        <path d="M16 4 q8 0 0 8" stroke={dark ? '#6b1b3f' : '#e7e2f4'} strokeWidth="2.4" fill="none" />
      </g>
      {tier >= 2 && (
        <g transform="translate(218 218)">
          <rect width="30" height="18" rx="2" fill="#2b2838" stroke="#fff3" />
          <circle cx="15" cy="9" r="5" fill="#0006" />
        </g>
      )}
    </g>
  );
}

/* ---------- 캐릭터 ---------- */

function Character({ dark, mood }: { dark: boolean; mood: Mood }) {
  return (
    <g className="char-body">
      {/* 몸 */}
      <path d="M112 262 C112 222 140 202 180 200 C220 202 248 222 248 262 Z" fill="var(--hoodie)" />
      <path d="M150 204 C160 222 200 222 210 204 L206 200 C196 212 164 212 154 200 Z" fill="var(--hoodie-dark)" />
      <path d="M168 214 v22 M192 214 v22" stroke="var(--hoodie-dark)" strokeWidth="2.4" strokeLinecap="round" />
      {dark ? (
        <path d="M150 204 q30 22 60 0" stroke="#c9c9d8" strokeWidth="2" fill="none" strokeDasharray="3 3" />
      ) : (
        <path d="M140 206 q40 -14 80 0" stroke="#d7e3ff" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.9" />
      )}
      {/* 목 */}
      <rect x="170" y="176" width="20" height="28" rx="6" fill="var(--skin-shade)" />
      {/* 머리 */}
      <ellipse cx="180" cy="140" rx="36" ry="40" fill="var(--skin)" />
      <circle cx="145" cy="146" r="6" fill="var(--skin)" />
      <circle cx="215" cy="146" r="6" fill="var(--skin)" />
      <Hair dark={dark} />
      <Face dark={dark} mood={mood} />
      <Mic dark={dark} mood={mood} />
    </g>
  );
}

function Hair({ dark }: { dark: boolean }) {
  if (dark) {
    return (
      <g>
        <path
          d="M142 136 C132 104 148 80 178 76 L172 60 L190 74 L200 54 L206 78 L226 64 L220 92 C226 108 224 124 218 138 C212 120 200 112 182 114 C166 114 150 122 142 136 Z"
          fill="var(--hair)"
        />
        <path d="M176 78 L186 112 L196 80 Z" fill="#ff2e5f" />
        <path d="M150 128 L158 150 L160 124" fill="var(--hair)" />
      </g>
    );
  }
  return (
    <g>
      <path
        d="M141 140 C136 100 156 82 182 82 C208 82 226 100 219 140 C212 122 196 114 180 116 C164 116 148 124 141 140 Z"
        fill="var(--hair)"
      />
      <path d="M141 140 C140 156 144 166 150 172 C148 156 148 148 152 136 Z" fill="var(--hair)" />
      <path d="M219 140 C220 156 216 166 210 172 C212 156 212 148 208 136 Z" fill="var(--hair)" />
      <path d="M160 100 q20 -10 40 0" stroke="#fff4" strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  );
}

function Face({ dark, mood }: { dark: boolean; mood: Mood }) {
  const eyeY = 140;
  const blush = mood === 'hot' ? 0.5 : dark ? 0.2 : 0.25;
  return (
    <g>
      <ellipse cx="156" cy="156" rx="7" ry="4" fill="#ff7d9a" opacity={blush} />
      <ellipse cx="204" cy="156" rx="7" ry="4" fill="#ff7d9a" opacity={blush} />
      {dark ? <DarkEyes mood={mood} y={eyeY} /> : <NormalEyes mood={mood} y={eyeY} />}
      {dark ? <DarkMouth mood={mood} /> : <NormalMouth mood={mood} />}
      {mood === 'hot' && (
        <g fill="#7fd4ff" className="sweat">
          <path d="M226 118 q6 10 0 14 q-6 -4 0 -14 Z" />
          <path d="M138 126 q5 8 0 12 q-5 -4 0 -12 Z" />
        </g>
      )}
      {mood === 'seized' && (
        <text x="236" y="112" className="ellipsis">
          …
        </text>
      )}
    </g>
  );
}

function NormalEyes({ mood, y }: { mood: Mood; y: number }) {
  if (mood === 'work') {
    return (
      <g stroke="var(--ink)" strokeWidth="3" fill="none" strokeLinecap="round">
        <path d={`M162 ${y + 2} q7 -8 14 0`} />
        <path d={`M184 ${y + 2} q7 -8 14 0`} />
      </g>
    );
  }
  if (mood === 'seized') {
    return (
      <g stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" fill="none">
        <path d={`M162 ${y - 4} l12 6 M174 ${y - 4} l-12 6`} />
        <path d={`M186 ${y - 4} l12 6 M198 ${y - 4} l-12 6`} />
      </g>
    );
  }
  const ry = mood === 'hot' ? 7.5 : 5.5;
  return (
    <g>
      <g className="eyes">
        <ellipse cx="168" cy={y} rx="5" ry={ry} fill="var(--ink)" />
        <ellipse cx="192" cy={y} rx="5" ry={ry} fill="var(--ink)" />
        <circle cx="169.6" cy={y - 2} r="1.7" fill="#fff" />
        <circle cx="193.6" cy={y - 2} r="1.7" fill="#fff" />
      </g>
      <path d={`M160 ${y - 14} q8 ${mood === 'hot' ? -4 : -6} 16 0 M184 ${y - 14} q8 -6 16 0`} stroke="var(--hair)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  );
}

function DarkEyes({ mood, y }: { mood: Mood; y: number }) {
  if (mood === 'seized') {
    return (
      <g>
        <ellipse cx="168" cy={y} rx="7" ry="8" fill="#fff" stroke="var(--ink)" strokeWidth="1.6" />
        <ellipse cx="192" cy={y} rx="7" ry="8" fill="#fff" stroke="var(--ink)" strokeWidth="1.6" />
        <circle cx="168" cy={y} r="1.8" fill="var(--ink)" />
        <circle cx="192" cy={y} r="1.8" fill="var(--ink)" />
        <path d={`M158 ${y - 14} l16 4 M202 ${y - 14} l-16 4`} stroke="var(--hair)" strokeWidth="3" strokeLinecap="round" />
      </g>
    );
  }
  if (mood === 'work') {
    return (
      <g>
        <path d={`M160 ${y + 3} l16 -7 M200 ${y + 3} l-16 -7`} stroke="var(--ink)" strokeWidth="3.4" strokeLinecap="round" />
        <path d={`M160 ${y - 11} l18 5 M200 ${y - 11} l-18 5`} stroke="var(--hair)" strokeWidth="3" strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g>
      <g className="eyes">
        <ellipse cx="168" cy={y} rx="7.5" ry="7" fill="#fff" stroke="var(--ink)" strokeWidth="1.6" />
        <ellipse cx="192" cy={y} rx="7.5" ry="7" fill="#fff" stroke="var(--ink)" strokeWidth="1.6" />
        <circle cx="170" cy={y + 1} r={mood === 'hot' ? 1.8 : 3.4} fill="var(--ink)" />
        <circle cx="190" cy={y - 1} r={mood === 'hot' ? 1.8 : 3.4} fill="var(--ink)" />
        <circle cx="171" cy={y} r="1" fill="#ff2e5f" />
      </g>
      <path d={`M158 ${y - 12} l18 6 M202 ${y - 16} l-18 8`} stroke="var(--hair)" strokeWidth="3" strokeLinecap="round" />
      <path d={`M159 ${y + 10} q9 5 17 0 M184 ${y + 10} q9 5 17 0`} stroke="#7a4a8a" strokeWidth="1.6" fill="none" opacity="0.7" />
    </g>
  );
}

function NormalMouth({ mood }: { mood: Mood }) {
  if (mood === 'work') return <ellipse cx="180" cy="163" rx="4.5" ry="3.6" fill="#8a3b4f" />;
  if (mood === 'hot') return <path d="M170 164 q5 -4 10 0 t10 0" stroke="#8a3b4f" strokeWidth="2.4" fill="none" strokeLinecap="round" />;
  if (mood === 'seized') return <path d="M172 164 h16" stroke="#8a3b4f" strokeWidth="2.6" strokeLinecap="round" />;
  return <path d="M171 160 q9 8 18 0" stroke="#8a3b4f" strokeWidth="2.6" fill="none" strokeLinecap="round" />;
}

function DarkMouth({ mood }: { mood: Mood }) {
  if (mood === 'seized') return <ellipse cx="180" cy="165" rx="7" ry="8" fill="#5a1530" stroke="var(--ink)" strokeWidth="1.5" />;
  if (mood === 'hot')
    return <path d="M164 164 l5 -6 l5 6 l5 -6 l5 6 l5 -6 l5 6" stroke="#5a1530" strokeWidth="2.6" fill="none" strokeLinejoin="round" />;
  if (mood === 'work')
    return (
      <g>
        <path d="M160 156 Q180 186 200 156 Z" fill="#5a1530" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M166 158 h28 v4 h-28 Z" fill="#fff" />
      </g>
    );
  return (
    <g>
      <path d="M160 156 Q180 180 200 156 Z" fill="#5a1530" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M166 158 h28 v4 h-28 Z" fill="#fff" />
    </g>
  );
}

function Mic({ dark, mood }: { dark: boolean; mood: Mood }) {
  if (mood === 'seized') return null;
  return (
    <g className="mic">
      <path d="M236 258 C246 232 240 206 228 190" stroke="var(--hoodie)" strokeWidth="20" fill="none" strokeLinecap="round" />
      <rect x="216" y="166" width="11" height="34" rx="5" transform="rotate(24 221 183)" fill="#2b2838" />
      <circle cx="207" cy="166" r="10" fill={dark ? '#ff2e5f' : '#4b4a63'} stroke="#1b1830" strokeWidth="2.4" />
      <circle cx="204" cy="162" r="3" fill="#fff" opacity="0.35" />
      <path d="M199 163 h16 M200 169 h14 M207 156 v20" stroke="#ffffff55" strokeWidth="1" />
      <circle cx="229" cy="192" r="8" fill="var(--skin)" />
    </g>
  );
}
