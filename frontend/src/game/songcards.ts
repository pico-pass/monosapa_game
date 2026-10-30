import { BALANCE } from './balance';
import { remasterCost, songCardOf, type SongCard } from './packdata';
import { clampResource } from './selectors';
import type { CommandResult, Fail, FailReason, GameState } from './types';

/* 곡 카드 덱: 발매한 싱글이 카드가 되고, 덱 6장의 바이브 보너스가 합산된다(합산은 packdata.bonuses). */

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export const songCards = (s: Pick<GameState, 'singles' | 'cards'>): SongCard[] => s.singles.map((x) => songCardOf(s.cards, x));

export function deckCards(s: Pick<GameState, 'singles' | 'cards'>): SongCard[] {
  const out: SongCard[] = [];
  for (const id of s.cards.deck) {
    const single = s.singles.find((x) => x.id === id);
    if (single) out.push(songCardOf(s.cards, single));
  }
  return out;
}

/** 덱에 넣거나 뺀다. */
export function toggleDeck(state: GameState, singleId: string): CommandResult<{ equipped: boolean }> {
  if (!state.singles.some((x) => x.id === singleId)) return fail(state, 'not_found');
  const on = state.cards.deck.includes(singleId);
  if (!on && state.cards.deck.length >= BALANCE.cards.deckSlots) return fail(state, 'full_slots');
  const deck = on ? state.cards.deck.filter((x) => x !== singleId) : [...state.cards.deck, singleId];
  return { ok: true, state: { ...state, cards: { ...state.cards, deck } }, equipped: !on };
}

/** 다음 리마스터 비용(코인). 최대 레벨이면 null */
export function nextRemasterCost(s: Pick<GameState, 'singles' | 'cards'>, singleId: string): number | null {
  const single = s.singles.find((x) => x.id === singleId);
  if (!single) return null;
  const c = songCardOf(s.cards, single);
  return c.remaster >= BALANCE.cards.remasterMax ? null : remasterCost(c.rarity, c.remaster);
}

export function remasterCard(state: GameState, singleId: string): CommandResult<{ cost: number; level: number }> {
  if (!state.singles.some((x) => x.id === singleId)) return fail(state, 'not_found');
  const cost = nextRemasterCost(state, singleId);
  if (cost === null) return fail(state, 'max_level');
  if (state.coins < cost) return fail(state, 'insufficient_coins');
  const level = (state.cards.remaster[singleId] ?? 0) + 1;
  return {
    ok: true,
    state: { ...state, coins: clampResource(state.coins - cost), cards: { ...state.cards, remaster: { ...state.cards.remaster, [singleId]: level } } },
    cost,
    level,
  };
}
