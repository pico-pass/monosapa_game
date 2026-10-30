import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { dayOf, hash32, unit } from '../common/week.js';
import { Save } from '../saves/save.schema.js';
import { User } from '../users/user.schema.js';
import { ChartClaim } from './chart.schema.js';
import type { ChartClaimDto, ChartClaimStatusDto, ChartDto, ChartEntryDto } from './dto/chart.dto.js';

export const CHART_SIZE = 100;
/** 한 사람이 차트에 올릴 수 있는 곡 수(가장 센 곡부터) */
const PER_USER = 3;
/** 이 기간 안에 저장한 계정의 곡만 올린다 */
const ACTIVE_MS = 30 * 24 * 3600_000;
/** 저장을 다시 읽는 간격 */
const CACHE_MS = 60_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NPC_COUNT = 120;
/** 보상이 나오는 순위 */
export const CHART_REWARD_RANK = 10;

/** 순위별 보상(다이아): 1위 5, 3위 안 3, 10위 안 1 */
export const chartReward = (rank: number): number => (rank === 1 ? 5 : rank <= 3 ? 3 : rank <= CHART_REWARD_RANK ? 1 : 0);

type Persona = 'normal' | 'dark';
interface Candidate {
  key: string;
  title: string;
  artist: string;
  persona: Persona;
  /** 곡이 나온 지 며칠이 됐는지를 정하는 발매 시각(ms). NPC는 null이라 신선도 1 */
  releasedAt: number | null;
  /** 팬 수에 해당하는 기본 힘 */
  base: number;
  userId: string | null;
}
interface Ranked extends Candidate {
  strength: number;
  revival: boolean;
}

const ADJ = ['새벽의', '식어버린', '오후 세 시의', '마지막', '이어폰 속', '비 맞은', '혼자 남은', '유리창 너머', '조용한', '번진', '지각한', '불 꺼진'];
const NOUN = ['편의점', '막차', '옥상', '일기장', '네온', '이불', '답장', '보름달', '골목', '자판기', '플레이리스트', '창가'];
const NPC_ARTISTS = ['낮잠', '새벽두시', '민트초코', '어제의나', '밤산책', '미열', '교실뒷자리', '비상계단', '지하철2호선', '야간버스', '감기약', '창밖'];

/** 지어낸 NPC 곡들. 이름·세기는 번호로만 정해진다(서버를 다시 켜도 같다). */
function npcCandidates(): Candidate[] {
  return Array.from({ length: NPC_COUNT }, (_, i) => {
    const h = hash32(`npc-${i}`);
    const strength = 8 + 70 * unit(h) ** 2.2;
    return {
      key: `npc:${i}`,
      title: `${ADJ[h % ADJ.length]} ${NOUN[(h >>> 8) % NOUN.length]}`,
      artist: NPC_ARTISTS[(h >>> 16) % NPC_ARTISTS.length],
      persona: unit(h + 1) < 0.5 ? 'normal' : 'dark',
      releasedAt: null,
      base: strength,
      userId: null,
    } satisfies Candidate;
  });
}

/** 한 곡의 그 시각 세기. 같은 입력이면 같은 결과라서 서버를 다시 켜거나 요청이 여러 번 와도 차트가 흔들리지 않는다. */
export function strengthOf(c: Pick<Candidate, 'key' | 'base' | 'releasedAt'>, at: number): { strength: number; revival: boolean } {
  const hour = Math.floor(at / HOUR);
  const day = Math.floor(at / DAY);
  const ageDays = c.releasedAt === null ? 0 : Math.max(0, (at - c.releasedAt) / DAY);
  const fresh = 0.6 + 0.4 * Math.exp(-ageDays / 14);
  const noise = 0.6 + 0.8 * unit(hash32(`${c.key}:h${hour}`));
  const revival = unit(hash32(`${c.key}:d${day}`)) < 0.04;
  return { strength: c.base * fresh * noise * (revival ? 4 : 1), revival };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 저장된 state에서 곡 목록을 뽑는다. 모양이 이상한 항목은 건너뛴다. */
export function singlesOf(state: unknown): { id: string; title: string; persona: Persona; releasedAt: number }[] {
  if (!isObj(state) || !Array.isArray(state.singles)) return [];
  const out: { id: string; title: string; persona: Persona; releasedAt: number }[] = [];
  for (const x of state.singles.slice(-2000)) {
    if (!isObj(x) || typeof x.id !== 'string' || typeof x.title !== 'string' || x.title.length === 0 || x.title.length > 200) continue;
    out.push({ id: x.id, title: x.title, persona: x.persona === 'dark' ? 'dark' : 'normal', releasedAt: typeof x.releasedAt === 'number' && Number.isFinite(x.releasedAt) ? x.releasedAt : 0 });
  }
  return out;
}

@Injectable()
export class ChartService {
  private cache: { at: number; users: Candidate[] } | null = null;
  private readonly npcs = npcCandidates();

  constructor(
    @InjectModel(Save.name) private readonly saves: Model<Save>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(ChartClaim.name) private readonly claims: Model<ChartClaim>,
  ) {}

  /** 사람들의 곡 후보(사람당 팬 수가 같으니 기본 힘이 같고, 곡마다 신선도·잡음으로 갈린다). 1분 동안 캐시한다. */
  private async userCandidates(now: number): Promise<Candidate[]> {
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.users;
    // 곡 목록만 읽는다(저장 전체는 최대 1MB라 투영으로 줄인다).
    const docs = (await this.saves.find({ savedAt: { $gt: now - ACTIVE_MS } }, { userId: 1, fans: 1, 'state.singles': 1 }).lean().exec()) as unknown as {
      userId: Types.ObjectId;
      fans?: number;
      state?: unknown;
    }[];
    const profiles = await this.users.find({ _id: { $in: docs.map((d) => d.userId) } }, { name: 1 }).lean().exec();
    const nameOf = new Map(profiles.map((u) => [String(u._id), u.name?.trim() || '익명']));
    const list: Candidate[] = [];
    for (const d of docs) {
      const uid = String(d.userId);
      const base = Math.sqrt(Math.max(0, d.fans ?? 0) + 1);
      for (const s of singlesOf(d.state)) {
        list.push({ key: `u:${uid}:${s.id}`, title: s.title, artist: nameOf.get(uid) ?? '익명', persona: s.persona, releasedAt: s.releasedAt, base, userId: uid });
      }
    }
    this.cache = { at: now, users: list };
    return list;
  }

  /** at 시각의 차트(내림차순). 사람당 PER_USER곡까지만 올린다. */
  private rank(users: Candidate[], at: number): Ranked[] {
    const scored: Ranked[] = [...users, ...this.npcs].map((c) => ({ ...c, ...strengthOf(c, at) }));
    scored.sort((a, b) => b.strength - a.strength || (a.key < b.key ? -1 : 1));
    const perUser = new Map<string, number>();
    const out: Ranked[] = [];
    for (const c of scored) {
      if (c.userId) {
        const n = perUser.get(c.userId) ?? 0;
        if (n >= PER_USER) continue;
        perUser.set(c.userId, n + 1);
      }
      out.push(c);
      if (out.length >= CHART_SIZE) break;
    }
    return out;
  }

  async chart(viewer: UserDto, now = Date.now()): Promise<ChartDto> {
    const users = await this.userCandidates(now);
    const current = this.rank(users, now);
    const before = new Map(this.rank(users, now - HOUR).map((c, i) => [c.key, i + 1]));
    const entries: ChartEntryDto[] = current.map((c, i) => {
      const prev = before.get(c.key) ?? null;
      const rank = i + 1;
      return {
        rank,
        change: prev === null ? null : prev - rank,
        title: c.title,
        artist: c.artist,
        persona: c.persona,
        mine: c.userId === viewer.id,
        revival: c.revival || (prev === null ? false : prev - rank >= 30),
      };
    });
    return { hourAt: Math.floor(now / HOUR) * HOUR, entries, claim: await this.claimStatus(viewer, entries, now) };
  }

  private async claimStatus(viewer: UserDto, entries: ChartEntryDto[], now: number): Promise<ChartClaimStatusDto> {
    const best = entries.find((e) => e.mine) ?? null;
    const claimedToday = !!(await this.claims.findOne({ userId: new Types.ObjectId(viewer.id), day: dayOf(now) }).lean().exec());
    const diamonds = best ? chartReward(best.rank) : 0;
    return { available: !!best && diamonds > 0 && !claimedToday, bestRank: best?.rank ?? null, bestTitle: best?.title ?? null, diamonds, claimedToday };
  }

  /** 10위 안에 내 곡이 있으면 하루 한 번 보상을 계산해 준다. 받은 것으로 표시하고, 반영은 클라이언트가 한다. */
  async claim(viewer: UserDto, now = Date.now()): Promise<ChartClaimDto> {
    const users = await this.userCandidates(now);
    const ranked = this.rank(users, now);
    const index = ranked.findIndex((c) => c.userId === viewer.id);
    const rank = index + 1;
    const best = ranked[index];
    if (index < 0 || rank > CHART_REWARD_RANK) throw new BadRequestException('10위 안에 든 내 곡이 있을 때만 받을 수 있어요.');
    try {
      await this.claims.create({ userId: new Types.ObjectId(viewer.id), day: dayOf(now), rank });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('오늘은 이미 받았어요.');
      throw e;
    }
    return { rank, title: best.title, diamonds: chartReward(rank), no1: rank === 1 };
  }
}
