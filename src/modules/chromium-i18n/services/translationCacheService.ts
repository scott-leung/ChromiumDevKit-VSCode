/**
 * Service for caching translation decorations per document.
 *
 * This service maintains a per-document cache of IDS translations to avoid
 * repeated database queries. Cache is invalidated when:
 * - Document content changes (debounced)
 * - Database is re-indexed
 * - User changes locale settings
 *
 * Cache structure: Map<documentUri, Map<idsName, TranslationInfo>>
 */

import * as vscode from 'vscode';

/**
 * Cached translation information for an IDS constant
 */
export interface TranslationInfo {
  /** IDS constant name (e.g., "IDS_APP_TITLE") */
  idsName: string;

  /** Primary translation text */
  translation: string;

  /** Additional translations count (if multiple GRD files contain this IDS) */
  additionalCount: number;

  /** Priority GRD path used for this translation (if resolved from #include) */
  priorityGrdPath?: string;

  /** All available translations (for multi-translation scenario) */
  allTranslations?: Array<{
    translation: string;
    grdPath: string;
  }>;

  /** Timestamp when cached (milliseconds) */
  cachedAt: number;
}

/**
 * Per-document translation cache
 */
interface DocumentCache {
  /** Map of IDS name → TranslationInfo */
  translations: Map<string, TranslationInfo>;

  /** Document version when cache was created */
  version: number;

  /** Timestamp when cache was created (milliseconds) */
  createdAt: number;

  /** Last access timestamp (milliseconds) */
  lastAccessAt: number;
}

/**
 * Service for managing per-document translation caches
 */
export class TranslationCacheService {
  /** Cache storage: documentUri → DocumentCache */
  private caches: Map<string, DocumentCache> = new Map();

  /** Cache TTL in milliseconds (default: 5 minutes) */
  private cacheTTL: number = 5 * 60 * 1000;

  /** Cleanup interval in milliseconds (default: 1 minute) */
  private cleanupInterval: number = 60 * 1000;

  /** Cleanup timer */
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Get cached translation for an IDS name in a document
   *
   * @param document VSCode text document
   * @param idsName IDS constant name
   * @returns Cached TranslationInfo or undefined if not cached
   */
  public get(document: vscode.TextDocument, idsName: string): TranslationInfo | undefined {
    const cache = this.getDocumentCache(document);
    if (!cache) {
      return undefined;
    }

    // Update last access time
    cache.lastAccessAt = Date.now();

    return cache.translations.get(idsName);
  }

  /**
   * Cache a translation for an IDS name in a document
   *
   * @param document VSCode text document
   * @param info Translation information to cache
   */
  public set(document: vscode.TextDocument, info: TranslationInfo): void {
    let cache = this.getDocumentCache(document);

    if (!cache) {
      // Create new cache for this document
      cache = {
        translations: new Map(),
        version: document.version,
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
      };
      this.caches.set(document.uri.toString(), cache);
    }

    // Update cache
    cache.translations.set(info.idsName, {
      ...info,
      cachedAt: Date.now(),
    });
    cache.lastAccessAt = Date.now();
  }

  /**
   * Batch set multiple translations for a document
   *
   * @param document VSCode text document
   * @param infos Array of translation information to cache
   */
  public batchSet(document: vscode.TextDocument, infos: TranslationInfo[]): void {
    let cache = this.getDocumentCache(document);

    if (!cache) {
      // Create new cache for this document
      cache = {
        translations: new Map(),
        version: document.version,
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
      };
      this.caches.set(document.uri.toString(), cache);
    }

    const now = Date.now();

    // Update cache
    for (const info of infos) {
      cache.translations.set(info.idsName, {
        ...info,
        cachedAt: now,
      });
    }

    cache.lastAccessAt = now;
  }

  /**
   * Invalidate cache for a specific document
   *
   * @param document VSCode text document
   */
  public invalidate(document: vscode.TextDocument): void {
    this.caches.delete(document.uri.toString());
  }

  /**
   * Invalidate all caches (e.g., when database is re-indexed or locale changes)
   */
  public invalidateAll(): void {
    this.caches.clear();
  }

  /**
   * Check if cache exists and is valid for a document
   *
   * @param document VSCode text document
   * @returns true if cache exists and matches document version
   */
  public has(document: vscode.TextDocument): boolean {
    const cache = this.caches.get(document.uri.toString());
    if (!cache) {
      return false;
    }

    // Check if document version matches (cache is invalidated if document changed)
    return cache.version === document.version;
  }

  /**
   * Get document cache if it exists and is valid
   *
   * @param document VSCode text document
   * @returns DocumentCache or undefined if not found or invalid
   */
  private getDocumentCache(document: vscode.TextDocument): DocumentCache | undefined {
    const cache = this.caches.get(document.uri.toString());
    if (!cache) {
      return undefined;
    }

    // Invalidate if document version changed
    if (cache.version !== document.version) {
      this.invalidate(document);
      return undefined;
    }

    return cache;
  }

  /**
   * Start periodic cleanup of expired caches
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * Stop cleanup timer
   */
  public stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Clean up expired caches based on TTL and last access time
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredUris: string[] = [];

    for (const [uri, cache] of this.caches.entries()) {
      const age = now - cache.lastAccessAt;
      if (age > this.cacheTTL) {
        expiredUris.push(uri);
      }
    }

    for (const uri of expiredUris) {
      this.caches.delete(uri);
    }

    if (expiredUris.length > 0) {
      console.log(`[TranslationCache] Cleaned up ${expiredUris.length} expired caches`);
    }
  }

  /**
   * Get cache statistics for debugging
   */
  public getStats(): {
    totalCaches: number;
    totalTranslations: number;
    oldestCache: number | null;
    newestCache: number | null;
  } {
    let totalTranslations = 0;
    let oldestCache: number | null = null;
    let newestCache: number | null = null;

    for (const cache of this.caches.values()) {
      totalTranslations += cache.translations.size;

      if (oldestCache === null || cache.createdAt < oldestCache) {
        oldestCache = cache.createdAt;
      }

      if (newestCache === null || cache.createdAt > newestCache) {
        newestCache = cache.createdAt;
      }
    }

    return {
      totalCaches: this.caches.size,
      totalTranslations,
      oldestCache,
      newestCache,
    };
  }

  /**
   * Dispose of service resources
   */
  public dispose(): void {
    this.stopCleanupTimer();
    this.caches.clear();
  }
}
