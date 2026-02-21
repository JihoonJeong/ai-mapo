/**
 * game-state.ts — GameState types + initialization
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// === Types ===

export interface PopulationByAge {
  [key: string]: number;
  child: number;
  teen: number;
  youth: number;
  midAge: number;
  senior: number;
  elderly: number;
}

export interface LivingPop {
  weekdayDay: number;
  weekdayNight: number;
  weekendDay: number;
  weekendNight: number;
}

export interface SatisfactionFactors {
  [key: string]: number;
  economy: number;
  transport: number;
  housing: number;
  safety: number;
  culture: number;
  welfare: number;
}

export interface BlockSummary {
  total: number;
  zoningConflicts: number;
}

export interface Dong {
  id: string;
  name: string;
  population: number;
  populationByAge: PopulationByAge;
  households: number;
  businesses: number;
  workers: number;
  avgWorkersPerBiz: number;
  commerceVitality: number;
  rentPressure: number;
  commerceCharacter: number;
  livingPop: LivingPop;
  satisfaction: number;
  satisfactionFactors: SatisfactionFactors;
  transitScore: number;
  blockSummary: BlockSummary;
  // Internal tracking (set after first tick)
  _initPop?: number;
  _initBiz?: number;
}

export interface Revenue {
  localTax: number;
  grantFromCity: number;
  subsidy: number;
  otherIncome: number;
}

export interface BudgetAllocation {
  economy: number;
  transport: number;
  culture: number;
  environment: number;
  education: number;
  welfare: number;
  renewal: number;
}

export interface Finance {
  totalBudget: number;
  mandatorySpend: number;
  freeBudget: number;
  allocation: BudgetAllocation;
  revenue: Revenue;
  fiscalIndependence: number;
  policyCost?: number;
}

export interface PolicyDef {
  id: string;
  name: string;
  category: string;
  cost: number;
  delay: number;
  duration: number;
  targetDong: string | string[] | null;
  effects: Record<string, Record<string, number>>;
  description?: string;
  prerequisites?: string[];
  incompatible?: string[];
}

export interface ActivePolicy {
  policy: PolicyDef;
  remainDelay: number;
  remainDuration: number;
  turnsActive: number;
}

export interface EventChoice {
  id: string;
  text: string;
  name?: string;
  description?: string;
  cost?: number;
  effects?: Record<string, Record<string, number>>;
  duration?: number;
  advisorComment?: string;
}

export interface GameEvent {
  id: string;
  name: string;
  description: string;
  choices: EventChoice[];
  trigger: Record<string, unknown>;
  probability?: number;
  cooldown?: number;
  oneShot?: boolean;
  affectedDongs?: string[];
}

export interface ActiveEvent {
  eventId: string;
  choiceId: string;
  choice: EventChoice;
  affectedDongs: string[];
  totalDuration: number;
  remainDuration: number;
}

export interface HistoryEntry {
  turn: number;
  totalPopulation: number;
  avgSatisfaction: number;
  fiscalIndependence: number;
  dongs: Array<{ id: string; population: number; satisfaction: number; businesses: number }>;
}

export interface GameMeta {
  turn: number;
  year: number;
  month: number;
  playerName: string;
  pledges: string[];
}

export interface GameState {
  meta: GameMeta;
  dongs: Dong[];
  finance: Finance;
  industryBreakdown: Record<string, unknown>;
  activePolicies: ActivePolicy[];
  activeEvents: ActiveEvent[];
  history: HistoryEntry[];
  _pledgeProgress?: Record<string, number>;
}

export interface PlayerActions {
  budget: BudgetAllocation;
  policies: PolicyDef[];
  eventChoice: ActiveEvent | null;
}

export type AdjacencyMap = Record<string, Record<string, number>>;

// === Data Loading ===

let cachedInitData: { dongs: Dong[]; finance: Finance; industryBreakdown: Record<string, unknown> } | null = null;
let cachedAdjacency: AdjacencyMap | null = null;
let cachedPolicies: PolicyDef[] | null = null;
let cachedEvents: GameEvent[] | null = null;

export async function loadInitData() {
  if (cachedInitData) return cachedInitData;
  const raw = await readFile(path.join(DATA_DIR, 'mapo_init.json'), 'utf-8');
  const data = JSON.parse(raw);
  cachedInitData = {
    dongs: data.dongs,
    finance: data.finance,
    industryBreakdown: data.industryBreakdown || {},
  };
  return cachedInitData;
}

export async function loadAdjacency(): Promise<AdjacencyMap> {
  if (cachedAdjacency) return cachedAdjacency;
  const raw = await readFile(path.join(DATA_DIR, 'adjacency.json'), 'utf-8');
  cachedAdjacency = JSON.parse(raw).adjacency;
  return cachedAdjacency!;
}

export async function loadPolicies(): Promise<PolicyDef[]> {
  if (cachedPolicies) return cachedPolicies;
  const raw = await readFile(path.join(DATA_DIR, 'policies.json'), 'utf-8');
  cachedPolicies = JSON.parse(raw).policies;
  return cachedPolicies!;
}

export async function loadEvents(): Promise<GameEvent[]> {
  if (cachedEvents) return cachedEvents;
  const raw = await readFile(path.join(DATA_DIR, 'events.json'), 'utf-8');
  cachedEvents = JSON.parse(raw).events;
  return cachedEvents!;
}

// === Game Initialization ===

export async function createGameState(): Promise<GameState> {
  const initData = await loadInitData();
  return {
    meta: { turn: 1, year: 2026, month: 1, playerName: 'Player', pledges: [] },
    dongs: initData.dongs.map(d => ({ ...d })),
    finance: { ...initData.finance },
    industryBreakdown: initData.industryBreakdown,
    activePolicies: [],
    activeEvents: [],
    history: [],
  };
}
