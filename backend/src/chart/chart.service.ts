import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { dayOf, hash32, unit } from '../common/week.js';
import { Save } from '../saves/save.schema.js';
import { User } from '../users/user.schema.js';
import { ChartClaim } from './chart.schema.js';
import type { ChartClaimDto, ChartClaimStatusDto, ChartDto, ChartEntryDto, ChartListDto, ChartPersona } from './dto/chart.dto.js';

/** 한 목록에 내려주는 곡 수의 상한(곡이 아주 많아져도 응답이 커지지 않게 한다). 순위는 전체 곡으로 매긴다. */
export const CHART_LIST_MAX = 1000;
/** 이 기간 안에 저장한 계정의 곡만 올린다 */
const ACTIVE_MS = 30 * 24 * 3600_000;
/** 저장을 다시 읽는 간격 */
const CACHE_MS = 60_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** 보상이 나오는 순위 */
export const CHART_REWARD_RANK = 10;

/** 순위별 보상(다이아): 1위 5, 3위 안 3, 10위 안 1 */
export const chartReward = (rank: number): number => (rank === 1 ? 5 : rank <= 3 ? 3 : rank <= CHART_REWARD_RANK ? 1 : 0);

type Persona = ChartPersona;
export const PERSONAS: readonly Persona[] = ['normal', 'dark'];
interface Candidate {
  key: string;
  title: string;
  artist: string;
  persona: Persona;
  /** 곡이 나온 지 며칠이 됐는지를 정하는 발매 시각(ms) */
  releasedAt: number;
  /** 팬 수에 해당하는 기본 힘 */
  base: number;
  userId: string;
}
interface Ranked extends Candidate {
  strength: number;
  revival: boolean;
}

/** 한 곡의 그 시각 세기. 같은 입력이면 같은 결과라서 서버를 다시 켜거나 요청이 여러 번 와도 차트가 흔들리지 않는다. */
export function strengthOf(c: Pick<Candidate, 'key' | 'base' | 'releasedAt'>, at: number): { strength: number; revival: boolean } {
  const hour = Math.floor(at / HOUR);
  const day = Math.floor(at / DAY);
  const ageDays = Math.max(0, (at - c.releasedAt) / DAY);
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

  constructor(
    @InjectModel(Save.name) private readonly saves: Model<Save>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(ChartClaim.name) private readonly claims: Model<ChartClaim>,
  ) {}

  /** 모든 계정의 모든 곡. 1분 동안 캐시한다. */
  private async candidates(now: number): Promise<Candidate[]> {
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

  /** at 시각의 한 속성 곡 전체 순위(내림차순) */
  private rank(all: Candidate[], at: number, persona: Persona): Ranked[] {
    return all
      .filter((c) => c.persona === persona)
      .map((c) => ({ ...c, ...strengthOf(c, at) }))
      .sort((a, b) => b.strength - a.strength || (a.key < b.key ? -1 : 1));
  }

  private list(all: Candidate[], now: number, persona: Persona, viewerId: string): ChartListDto {
    const current = this.rank(all, now, persona);
    const before = new Map(this.rank(all, now - HOUR, persona).map((c, i) => [c.key, i + 1]));
    const entries: ChartEntryDto[] = current.slice(0, CHART_LIST_MAX).map((c, i) => {
      const prev = before.get(c.key) ?? null;
      const rank = i + 1;
      return { rank, change: prev === null ? null : prev - rank, title: c.title, artist: c.artist, mine: c.userId === viewerId, revival: c.revival || (prev !== null && prev - rank >= 30) };
    });
    return { total: current.length, entries };
  }

  async chart(viewer: UserDto, now = Date.now()): Promise<ChartDto> {
    const all = await this.candidates(now);
    const normal = this.list(all, now, 'normal', viewer.id);
    const dark = this.list(all, now, 'dark', viewer.id);
    return { hourAt: Math.floor(now / HOUR) * HOUR, normal, dark, claim: await this.claimStatus(viewer, { normal, dark }, now) };
  }

  /** 내 곡 중 가장 높은 순위를 두 목록에서 찾는다(같으면 일반). 내 곡이 상한 밖이면 없는 것으로 본다. */
  private bestOf(lists: Record<Persona, ChartListDto>): { rank: number; persona: Persona; title: string } | null {
    let best: { rank: number; persona: Persona; title: string } | null = null;
    for (const persona of PERSONAS) {
      const mine = lists[persona].entries.find((e) => e.mine);
      if (mine && (!best || mine.rank < best.rank)) best = { rank: mine.rank, persona, title: mine.title };
    }
    return best;
  }

  private async claimStatus(viewer: UserDto, lists: Record<Persona, ChartListDto>, now: number): Promise<ChartClaimStatusDto> {
    const best = this.bestOf(lists);
    const claimedToday = !!(await this.claims.findOne({ userId: new Types.ObjectId(viewer.id), day: dayOf(now) }).lean().exec());
    const diamonds = best ? chartReward(best.rank) : 0;
    return { available: !!best && diamonds > 0 && !claimedToday, bestRank: best?.rank ?? null, bestPersona: best?.persona ?? null, bestTitle: best?.title ?? null, diamonds, claimedToday };
  }

  /** 10위 안에 내 곡이 있으면 하루 한 번 보상을 계산해 준다. 받은 것으로 표시하고, 반영은 클라이언트가 한다. */
  async claim(viewer: UserDto, now = Date.now()): Promise<ChartClaimDto> {
    const all = await this.candidates(now);
    const best = this.bestOf({ normal: this.list(all, now, 'normal', viewer.id), dark: this.list(all, now, 'dark', viewer.id) });
    if (!best || best.rank > CHART_REWARD_RANK) throw new BadRequestException('10위 안에 든 내 곡이 있을 때만 받을 수 있어요.');
    try {
      await this.claims.create({ userId: new Types.ObjectId(viewer.id), day: dayOf(now), rank: best.rank });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('오늘은 이미 받았어요.');
      throw e;
    }
    return { rank: best.rank, persona: best.persona, title: best.title, diamonds: chartReward(best.rank), no1: best.rank === 1 };
  }
}
