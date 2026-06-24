import * as fs from "fs";
import * as path from "path";
import { ParsedModule } from "../parsers/types";
import { logger } from "./logger";

interface CacheEntry {
  mtimeMs: number;
  sizeBytes: number;
  module: ParsedModule;
}

/**
 * File-based cache for parsed AST modules.
 * Invalidates cache entries when the source file's mtime or size changes.
 * Avoids re-parsing unchanged files, significantly speeding up repeated runs.
 */
export class ASTCache {
  private cache: Map<string, CacheEntry> = new Map();
  private hits = 0;
  private misses = 0;

  /**
   * Gets a cached ParsedModule if the file hasn't changed since last parse.
   * Returns null if cache miss or file has been modified.
   */
  get(filePath: string): ParsedModule | null {
    const entry = this.cache.get(filePath);
    if (!entry) {
      this.misses++;
      return null;
    }

    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs === entry.mtimeMs && stat.size === entry.sizeBytes) {
        this.hits++;
        logger.debug(`Cache hit: ${path.basename(filePath)}`);
        return entry.module;
      }
    } catch {
      // File may have been deleted
    }

    this.cache.delete(filePath);
    this.misses++;
    return null;
  }

  /** Stores a parsed module in the cache, indexed by file path. */
  set(filePath: string, module: ParsedModule): void {
    try {
      const stat = fs.statSync(filePath);
      this.cache.set(filePath, {
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        module,
      });
    } catch {
      // If stat fails, don't cache
    }
  }

  /** Clears the entire cache. */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Returns cache statistics. */
  stats(): { hits: number; misses: number; size: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
    };
  }
}

/** Global shared cache instance. */
export const globalCache = new ASTCache();
