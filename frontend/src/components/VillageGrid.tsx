import { BUILDING_TEXT, ZONE_TEXT } from '../game/content';
import type { VillageTile } from '../game/types';
import { VILLAGE_W, zoneOf } from '../game/villagedata';

interface Props {
  tiles: readonly (VillageTile | null)[];
  /** 열린 땅의 한 변 */
  side: number;
  selected?: number | null;
  /** 이사 중이면 빈 칸이 강조된다 */
  moving?: boolean;
  /** 읽기 전용(친구 마을)이면 칸을 누를 수 없다 */
  onPick?: (i: number) => void;
}

/** 팬 마을의 땅. 8×8 땅의 가운데에서 열린 side×side 칸만 그린다. 구역(일반·황혼·어둠)은 칸 색으로 보인다. */
export function VillageGrid({ tiles, side, selected = null, moving = false, onPick }: Props) {
  const off = (VILLAGE_W - side) / 2;
  const cells: number[] = [];
  for (let y = off; y < off + side; y++) for (let x = off; x < off + side; x++) cells.push(y * VILLAGE_W + x);
  return (
    <div className="village-grid" style={{ gridTemplateColumns: `repeat(${side}, 1fr)` }} role="group" aria-label="팬 마을">
      {cells.map((i) => {
        const t = tiles[i] ?? null;
        const zone = zoneOf(i);
        const text = t ? BUILDING_TEXT[t.b] : null;
        const label = t && text ? `${text.name} ${t.lv}레벨` : `빈 칸 (${ZONE_TEXT[zone].name})`;
        return (
          <button
            key={i}
            type="button"
            className={`vcell vz-${zone}${t ? ' vcell-built' : ''}${selected === i ? ' vcell-sel' : ''}${moving && !t ? ' vcell-target' : ''}`}
            aria-label={label}
            aria-pressed={selected === i}
            disabled={!onPick}
            onClick={() => onPick?.(i)}
          >
            {t && text ? (
              <>
                <span className="vcell-icon" aria-hidden>
                  {text.icon}
                </span>
                <small className="vcell-lv">{t.lv}</small>
              </>
            ) : (
              <span className="vcell-plus" aria-hidden>
                ＋
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
