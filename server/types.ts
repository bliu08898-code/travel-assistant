export type Vibe = 'quiet' | 'curious' | 'active' | 'local' | 'surprise'
export type Budget = 'free' | 'any' | 'custom'

export interface QuestInput {
  locationLabel: string
  coordinates?: { latitude: number; longitude: number }
  earliestStartMode: 'now' | 'custom'
  earliestStartDate: string
  earliestStartTime: string
  freeUntilDate: string
  freeUntil: string
  partySize: string
  vibe: Vibe
  budget: Budget
  customBudget: string
}

export interface Quest {
  id: string
  providerId: string
  eyebrow: string
  title: string
  place: string
  category: string
  address: string
  travel: string
  duration: string
  closing: string
  cost: string
  mission: string
  reason: string
  accent: string
  navigationUrl: string
  sourceLabel: string
  verifiedAt: string
  verificationNote: string
  partyLabel: string
  schedule: string
  operatingStatus: 'verified' | 'unknown'
}
