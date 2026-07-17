import { keccak256, toHex } from 'viem'
import type { Hex } from './types.js'

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    )
  }
  return typeof value === 'bigint' ? value.toString() : value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export function contentHash(value: unknown): Hex {
  return keccak256(toHex(canonicalJson(value)))
}
