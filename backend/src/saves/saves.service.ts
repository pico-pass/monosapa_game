import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { PutSaveDto, PutSaveResultDto, SaveDto } from './dto/save.dto.js';
import { Save, type SaveDocument } from './save.schema.js';

const MAX_STATE_BYTES = 1_000_000;
const MAX_DEPTH = 8;
/** 이전 저장을 백업으로 옮기는 최소 간격 */
const BACKUP_MIN_INTERVAL_MS = 60 * 60 * 1000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 몽고 필드 이름으로 쓸 수 없는 키($로 시작, . 포함)와 너무 깊은 중첩을 막는다. */
function checkShape(v: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (Array.isArray(v)) return v.every((x) => checkShape(x, depth + 1));
  if (isObj(v)) return Object.entries(v).every(([k, x]) => !k.startsWith('$') && !k.includes('.') && checkShape(x, depth + 1));
  return true;
}

/** 게임의 playerLevel(frontend/src/game/selectors.ts)과 같은 식. BALANCE.level.fansPerStep 이 바뀌면 여기도 맞춘다. */
const FANS_PER_LEVEL_STEP = 20;

/** 무한의 계단 최고 층의 상한(이상한 값이 랭킹을 차지하지 못하게 한다) */
export const MAX_TOWER_FLOOR = 1_000_000;

/** 저장된 state 에서 랭킹용 팬 수·레벨·계단 최고 층을 뽑는다. 이상한 값은 0명(레벨 1)·0층으로 본다. */
export function rankFieldsOf(state: Record<string, unknown>): { fans: number; level: number; towerBest: number } {
  const raw = state.fans;
  const fans = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1e15) : 0;
  const tower = isObj(state.arcade) && isObj(state.arcade.tower) ? state.arcade.tower.best : 0;
  const towerBest = typeof tower === 'number' && Number.isInteger(tower) && tower > 0 ? Math.min(tower, MAX_TOWER_FLOOR) : 0;
  return { fans, level: 1 + Math.floor(Math.sqrt(fans / FANS_PER_LEVEL_STEP)), towerBest };
}

const toDto = (d: SaveDocument): SaveDto => ({ state: d.state, version: d.version, savedAt: d.savedAt });

@Injectable()
export class SavesService {
  constructor(@InjectModel(Save.name) private readonly saves: Model<Save>) {}

  async get(userId: string): Promise<SaveDto | null> {
    const doc = await this.saves.findOne({ userId: new Types.ObjectId(userId) }).exec();
    return doc ? toDto(doc) : null;
  }

  /** 저장한다. 클라이언트가 아는 버전이 서버와 다르면(그 사이 다른 기기가 저장) 서버 저장을 담아 409 로 돌려준다. */
  async put(userId: string, body: PutSaveDto | undefined): Promise<PutSaveResultDto> {
    const { state, baseVersion, writerId } = body ?? ({} as Partial<PutSaveDto>);
    if (!isObj(state) || !Number.isInteger(state.schemaVersion) || typeof state.savedAt !== 'number' || !Number.isFinite(state.savedAt)) {
      throw new BadRequestException('state 가 올바르지 않아요.');
    }
    if (!Number.isInteger(baseVersion) || (baseVersion as number) < 0) throw new BadRequestException('baseVersion 이 올바르지 않아요.');
    if (typeof writerId !== 'string' || writerId.length === 0 || writerId.length > 64) throw new BadRequestException('writerId 가 올바르지 않아요.');
    if (!checkShape(state) || Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) throw new BadRequestException('저장 데이터가 너무 크거나 형식이 올바르지 않아요.');

    const uid = new Types.ObjectId(userId);
    const savedAt = state.savedAt as number;
    const current = await this.saves.findOne({ userId: uid }).exec();

    if (!current) {
      try {
        const created = await this.saves.create({ userId: uid, state, ...rankFieldsOf(state), version: 1, savedAt, lastWriter: writerId, backup: null });
        return { version: created.version, savedAt };
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        return this.conflict(uid); // 동시에 다른 기기가 처음 저장했다
      }
    }

    if (current.version !== baseVersion && current.lastWriter !== writerId) throw this.conflictOf(current);

    const keepBackup = current.backup !== null && current.savedAt - current.backup.savedAt < BACKUP_MIN_INTERVAL_MS;
    const backup = keepBackup ? current.backup : { state: current.state, savedAt: current.savedAt };
    // 읽은 뒤 다른 요청이 먼저 저장했으면 version 이 달라 매치되지 않는다.
    const res = await this.saves
      .updateOne({ _id: current._id, version: current.version }, { $set: { state, ...rankFieldsOf(state), savedAt, lastWriter: writerId, backup }, $inc: { version: 1 } })
      .exec();
    if (res.matchedCount === 0) return this.conflict(uid);
    return { version: current.version + 1, savedAt };
  }

  private async conflict(uid: Types.ObjectId): Promise<never> {
    const latest = await this.saves.findOne({ userId: uid }).orFail().exec();
    throw this.conflictOf(latest);
  }

  private conflictOf(doc: SaveDocument): ConflictException {
    return new ConflictException({ message: '다른 기기에서 더 최근에 저장했어요.', save: toDto(doc) });
  }
}
