/**
 * Redaction Cache - Session-only storage for redaction patterns
 * 
 * SECURITY: This cache stores HASHED values only, not raw PII.
 * Uses sessionStorage (not localStorage) so data is cleared when browser closes.
 * 
 * The cache helps identify previously redacted patterns within a session,
 * but does NOT persist sensitive data across sessions.
 */

import { EntityType } from './patterns';

export interface CachedRedaction {
  id: string;
  /** Hash of the original value - NOT the raw PII */
  valueHash: string;
  /** The masked/redacted version (safe to store) */
  maskedValue: string;
  /** Type of entity */
  type: EntityType;
  /** When this was cached */
  createdAt: string;
  /** How many times this pattern was used */
  usageCount: number;
  /** Length of original value (for matching) */
  valueLength: number;
}

const CACHE_KEY = 'redaction-session-cache';
const MAX_CACHE_SIZE = 200; // Smaller limit for session cache

/**
 * Simple hash function for creating non-reversible identifiers
 * This is NOT cryptographic - just for pattern matching within a session
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Add length and first/last char info for better uniqueness
  const prefix = str.length > 0 ? str.charCodeAt(0).toString(16) : '00';
  const suffix = str.length > 1 ? str.charCodeAt(str.length - 1).toString(16) : '00';
  return `${prefix}${Math.abs(hash).toString(16)}${suffix}${str.length}`;
}

/**
 * Get all cached redactions from sessionStorage
 */
export function getCachedRedactions(): CachedRedaction[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) return [];
    return JSON.parse(cached) as CachedRedaction[];
  } catch {
    return [];
  }
}

/**
 * Save cached redactions to sessionStorage
 */
function saveCachedRedactions(redactions: CachedRedaction[]): void {
  if (typeof window === 'undefined') return;
  
  try {
    // Limit cache size by removing oldest, least-used items
    const sorted = [...redactions].sort((a, b) => {
      if (b.usageCount !== a.usageCount) {
        return b.usageCount - a.usageCount;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    
    const trimmed = sorted.slice(0, MAX_CACHE_SIZE);
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    // Session storage might be full or disabled
  }
}

/**
 * Add a redaction to the cache (stores hash only, not raw value)
 */
export function addToCache(value: string, maskedValue: string, type: EntityType): void {
  const cache = getCachedRedactions();
  const valueHash = simpleHash(value.toLowerCase());
  
  // Check if this hash already exists
  const existingIndex = cache.findIndex(r => r.valueHash === valueHash);
  
  if (existingIndex >= 0) {
    cache[existingIndex].usageCount += 1;
    cache[existingIndex].maskedValue = maskedValue;
  } else {
    const newEntry: CachedRedaction = {
      id: crypto.randomUUID(),
      valueHash,
      maskedValue,
      type,
      createdAt: new Date().toISOString(),
      usageCount: 1,
      valueLength: value.length,
    };
    cache.push(newEntry);
  }
  
  saveCachedRedactions(cache);
}

/**
 * Add multiple redactions to the cache at once
 */
export function addMultipleToCache(items: Array<{ value: string; maskedValue: string; type: EntityType }>): void {
  const cache = getCachedRedactions();
  
  for (const item of items) {
    const valueHash = simpleHash(item.value.toLowerCase());
    const existingIndex = cache.findIndex(r => r.valueHash === valueHash);
    
    if (existingIndex >= 0) {
      cache[existingIndex].usageCount += 1;
      cache[existingIndex].maskedValue = item.maskedValue;
    } else {
      cache.push({
        id: crypto.randomUUID(),
        valueHash,
        maskedValue: item.maskedValue,
        type: item.type,
        createdAt: new Date().toISOString(),
        usageCount: 1,
        valueLength: item.value.length,
      });
    }
  }
  
  saveCachedRedactions(cache);
}

/**
 * Remove a redaction from the cache
 */
export function removeFromCache(id: string): void {
  const cache = getCachedRedactions();
  const filtered = cache.filter(r => r.id !== id);
  saveCachedRedactions(filtered);
}

/**
 * Clear the entire cache
 */
export function clearCache(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(CACHE_KEY);
}

/**
 * Find cached redactions that match text in a document
 * Returns matches with their positions in the text
 * 
 * NOTE: This now uses hash comparison, so it can only find exact matches
 * of previously cached values within the same session.
 */
export function findCachedMatches(text: string): Array<{
  cached: CachedRedaction;
  startIndex: number;
  endIndex: number;
}> {
  const cache = getCachedRedactions();
  if (cache.length === 0) return [];
  
  const matches: Array<{
    cached: CachedRedaction;
    startIndex: number;
    endIndex: number;
  }> = [];
  
  const lowerText = text.toLowerCase();
  
  // For each cached item, we need to scan the text for potential matches
  // Since we only have hashes, we scan for substrings of the same length
  // and check if their hash matches
  for (const cached of cache) {
    const len = cached.valueLength;
    if (len > lowerText.length) continue;
    
    for (let i = 0; i <= lowerText.length - len; i++) {
      const substring = lowerText.substring(i, i + len);
      const substringHash = simpleHash(substring);
      
      if (substringHash === cached.valueHash) {
        // Potential match found - add it
        matches.push({
          cached,
          startIndex: i,
          endIndex: i + len,
        });
        // Skip ahead to avoid overlapping matches
        i += len - 1;
      }
    }
  }
  
  // Sort by position and remove overlapping matches
  matches.sort((a, b) => a.startIndex - b.startIndex);
  
  const deduped: typeof matches = [];
  for (const match of matches) {
    const overlaps = deduped.some(
      m => (match.startIndex >= m.startIndex && match.startIndex < m.endIndex) ||
           (match.endIndex > m.startIndex && match.endIndex <= m.endIndex)
    );
    if (!overlaps) {
      deduped.push(match);
    }
  }
  
  return deduped;
}

/**
 * Check if a specific value exists in the cache (by hash)
 */
export function isValueCached(value: string): CachedRedaction | null {
  const cache = getCachedRedactions();
  const valueHash = simpleHash(value.toLowerCase());
  return cache.find(r => r.valueHash === valueHash) || null;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  totalItems: number;
  totalUsage: number;
  byType: Record<string, number>;
} {
  const cache = getCachedRedactions();
  
  const byType: Record<string, number> = {};
  let totalUsage = 0;
  
  for (const item of cache) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    totalUsage += item.usageCount;
  }
  
  return {
    totalItems: cache.length,
    totalUsage,
    byType,
  };
}

/**
 * Export cache as JSON for backup (contains only hashes, not raw PII)
 */
export function exportCache(): string {
  const cache = getCachedRedactions();
  return JSON.stringify(cache, null, 2);
}

/**
 * Import cache from JSON backup
 * NOTE: Imported cache will only work for exact same values due to hashing
 */
export function importCache(json: string, merge: boolean = true): void {
  try {
    const imported = JSON.parse(json) as CachedRedaction[];
    
    // Validate imported data has required fields
    const valid = imported.every(item => 
      item.valueHash && item.maskedValue && item.type && item.valueLength
    );
    
    if (!valid) {
      throw new Error('Invalid cache format');
    }
    
    if (merge) {
      const existing = getCachedRedactions();
      const merged = [...existing];
      
      for (const item of imported) {
        const existingIndex = merged.findIndex(r => r.valueHash === item.valueHash);
        if (existingIndex >= 0) {
          if (item.usageCount > merged[existingIndex].usageCount) {
            merged[existingIndex] = item;
          }
        } else {
          merged.push(item);
        }
      }
      
      saveCachedRedactions(merged);
    } else {
      saveCachedRedactions(imported);
    }
  } catch {
    throw new Error('Invalid cache format');
  }
}
