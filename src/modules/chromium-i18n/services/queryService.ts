/**
 * Query Service
 * Handles all database operations for the Chromium I18n extension
 * Uses @vscode/sqlite3 (VSCode's built-in SQLite) for cross-version compatibility
 *
 * IMPORTANT: All paths stored in the database are RELATIVE to Chromium root.
 * This reduces database size and ensures portability across different machines.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  IFile,
  IMessage,
  ITranslation,
  IMessageWithTranslations,
  ITranslationStats,
  ISearchResult,
} from '../models';
import { getDatabaseFileName } from '../utils/hashUtils';
import { toRelativePath, toAbsolutePath } from '../../../shared/utils/chromiumUtils';

// Use @vscode/sqlite3 instead of better-sqlite3
// This uses VSCode's built-in SQLite, ensuring compatibility across VSCode versions
type Database = any; // Will be imported at runtime

/**
 * QueryService singleton
 * Manages SQLite database connection and provides query methods
 */
export class QueryService {
  private static instance: QueryService | null = null;
  private db: Database | null = null;
  private chromiumRoot: string | null = null;
  private dbPath: string | null = null;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get QueryService singleton instance
   */
  public static getInstance(): QueryService {
    if (!QueryService.instance) {
      QueryService.instance = new QueryService();
    }
    return QueryService.instance;
  }

  /**
   * Initialize database connection
   * Creates database file in VSCode global storage if it doesn't exist
   * Executes schema creation SQL
   *
   * @param context VSCode Extension Context (for globalStorageUri)
   * @param chromiumRoot Chromium source root path (for path calculations and db hash)
   */
  public async initialize(context: vscode.ExtensionContext, chromiumRoot: string): Promise<void> {
    this.chromiumRoot = chromiumRoot;

    // Get global storage path (create if doesn't exist)
    const storagePath = context.globalStorageUri.fsPath;
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }

    // Create database file path with Chromium root hash
    const dbFileName = getDatabaseFileName(chromiumRoot);
    this.dbPath = path.join(storagePath, dbFileName);

    console.log(`[QueryService] Initializing database: ${this.dbPath}`);
    console.log(`[QueryService] Chromium root: ${chromiumRoot}`);

    // Import @vscode/sqlite3 at runtime (VSCode ships it); handle both ESM default and CJS shapes
    const sqlite3Module = await import('@vscode/sqlite3');
    const sqlite3 = (sqlite3Module as any).default ?? sqlite3Module;

    // Open database connection (node-sqlite3 API style - async)
    return new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(this.dbPath!, (err: Error | null) => {
        if (err) {
          console.error('[QueryService] Failed to open database:', err);
          reject(err);
          return;
        }

        this.db = db;

        // Execute schema creation asynchronously after database is open
        (async () => {
          try {
            // Enable foreign keys
            await this.runAsync('PRAGMA foreign_keys = ON');

            // Execute schema creation
            await this.createSchema();

            console.log('[QueryService] Database initialized successfully');
            resolve();
          } catch (error) {
            console.error('[QueryService] Failed to initialize schema:', error);
            reject(error);
          }
        })();
      });
    });
  }

  /**
   * Create database schema (tables and indexes)
   * Reads schema from contracts/database-schema.sql
   */
  private async createSchema(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Read schema SQL file
    const schemaPath = path.join(
      __dirname,
      '../../../../specs/001-chromium-i18n/contracts/database-schema.sql',
    );

    if (!fs.existsSync(schemaPath)) {
      // If schema file doesn't exist in specs, use embedded schema
      console.log('[QueryService] Schema file not found, using embedded schema');
      await this.createEmbeddedSchema();
      return;
    }

    console.log('[QueryService] Reading schema from:', schemaPath);
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

    // Remove all comment lines (lines starting with --)
    const sqlWithoutComments = schemaSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    // Execute schema (split by semicolon and filter out empty statements)
    const statements = sqlWithoutComments
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    console.log(`[QueryService] Executing ${statements.length} SQL statements`);
    for (const stmt of statements) {
      console.log('[QueryService] Executing:', stmt.substring(0, 100));
      await this.runAsync(stmt);
    }

    // Ensure newer tables exist even if the external schema is outdated
    await this.ensureMessageNamesTable();
    await this.ensureProgressTables();
    await this.backfillMessageNames();

    console.log('[QueryService] Schema creation completed');
  }

  /**
   * Create embedded schema (fallback if schema file not found)
   */
  private async createEmbeddedSchema(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Files table
    await this.runAsync(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        mtime_ms INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('grd', 'grdp', 'xtb')),
        parent_grd_path TEXT,
        lang TEXT
      )
    `);

    await this.runAsync('CREATE INDEX IF NOT EXISTS idx_files_path ON files(path)');
    await this.runAsync('CREATE INDEX IF NOT EXISTS idx_files_type ON files(type)');
    await this.runAsync('CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent_grd_path)');

    // Messages table
    await this.runAsync(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        english TEXT NOT NULL,
        presentable_text TEXT NOT NULL,
        desc TEXT,
        meaning TEXT,
        grd_path TEXT NOT NULL,
        grdp_path TEXT,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL
      )
    `);

    await this.runAsync('CREATE INDEX IF NOT EXISTS idx_messages_hash ON messages(id_hash)');
    await this.runAsync('CREATE INDEX IF NOT EXISTS idx_messages_name ON messages(name)');
    await this.runAsync('CREATE INDEX IF NOT EXISTS idx_messages_grd ON messages(grd_path)');
    await this.runAsync('CREATE INDEX IF NOT EXISTS idx_messages_grdp ON messages(grdp_path)');

    // Alias table: map IDS names to hash IDs (handles multiple names sharing same hash)
    await this.runAsync(`
      CREATE TABLE IF NOT EXISTS message_names (
        name TEXT PRIMARY KEY,
        id_hash TEXT NOT NULL,
        FOREIGN KEY (id_hash) REFERENCES messages(id_hash) ON DELETE CASCADE
      )
    `);
    await this.runAsync('CREATE INDEX IF NOT EXISTS idx_message_names_hash ON message_names(id_hash)');
    await this.backfillMessageNames();

    // Translations table
    await this.runAsync(`
      CREATE TABLE IF NOT EXISTS translations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_hash TEXT NOT NULL,
        lang TEXT NOT NULL,
        text TEXT NOT NULL,
        xtb_path TEXT NOT NULL,
        FOREIGN KEY (id_hash) REFERENCES messages(id_hash) ON DELETE CASCADE,
        UNIQUE (id_hash, lang)
      )
    `);

    await this.runAsync(
      'CREATE INDEX IF NOT EXISTS idx_translations_hash ON translations(id_hash)',
    );
    await this.runAsync('CREATE INDEX IF NOT EXISTS idx_translations_lang ON translations(lang)');
    await this.runAsync(
      'CREATE INDEX IF NOT EXISTS idx_translations_xtb ON translations(xtb_path)',
    );

    // Progress tracking tables
    await this.ensureProgressTables();

    console.log('[QueryService] Embedded schema created');
  }

  /**
   * Close database connection
   */
  public close(): void {
    if (this.db) {
      this.db.close((err: Error | null) => {
        if (err) {
          console.error('[QueryService] Error closing database:', err);
        } else {
          console.log('[QueryService] Database connection closed');
        }
      });
      this.db = null;
    }
  }

  /**
   * Check if database is initialized
   */
  public isInitialized(): boolean {
    return this.db !== null;
  }

  /**
   * Get Chromium root path
   */
  public getChromiumRoot(): string {
    if (!this.chromiumRoot) {
      throw new Error('Chromium root path not set');
    }
    return this.chromiumRoot;
  }

  /**
   * Ensure alias table exists (backward-compatible upgrade path)
   */
  private async ensureMessageNamesTable(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    await this.runAsync(`
      CREATE TABLE IF NOT EXISTS message_names (
        name TEXT PRIMARY KEY,
        id_hash TEXT NOT NULL,
        FOREIGN KEY (id_hash) REFERENCES messages(id_hash) ON DELETE CASCADE
      )
    `);
    await this.runAsync('CREATE INDEX IF NOT EXISTS idx_message_names_hash ON message_names(id_hash)');
  }

  /**
   * Backfill alias table for existing messages (safe to run multiple times)
   */
  private async backfillMessageNames(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    await this.runAsync(
      `INSERT OR IGNORE INTO message_names (name, id_hash)
       SELECT name, id_hash FROM messages`,
    );
  }

  /**
   * Ensure progress tracking tables exist (singleton progress + processed files)
   */
  private async ensureProgressTables(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    await this.runAsync(`
      CREATE TABLE IF NOT EXISTS index_progress (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        status TEXT NOT NULL CHECK(status IN ('idle', 'indexing', 'completed', 'cancelled')) DEFAULT 'idle',
        total_files INTEGER DEFAULT 0,
        processed_count INTEGER DEFAULT 0,
        start_time INTEGER,
        last_update_time INTEGER
      )
    `);

    await this.runAsync(`
      CREATE TABLE IF NOT EXISTS index_processed_files (
        grd_path TEXT PRIMARY KEY,
        processed_at INTEGER NOT NULL
      )
    `);

    await this.runAsync(
      'CREATE INDEX IF NOT EXISTS idx_processed_files_time ON index_processed_files(processed_at)',
    );
  }

  /**
   * Get workspace path
   * @deprecated Use getChromiumRoot() instead
   */
  public getWorkspacePath(): string {
    return this.getChromiumRoot();
  }

  /**
   * Get database file path
   */
  public getDatabasePath(): string | null {
    return this.dbPath;
  }

  // ==========================================
  // Path Conversion Methods
  // ==========================================

  /**
   * Convert absolute path to relative path for storage
   * @param absolutePath Absolute file path
   * @returns Relative path from Chromium root
   */
  public pathToRelative(absolutePath: string): string {
    if (!this.chromiumRoot) {
      throw new Error('Chromium root not initialized');
    }
    return toRelativePath(absolutePath, this.chromiumRoot);
  }

  /**
   * Convert relative path to absolute path for file operations
   * @param relativePath Relative path from Chromium root
   * @returns Absolute file path
   */
  public pathToAbsolute(relativePath: string): string {
    if (!this.chromiumRoot) {
      throw new Error('Chromium root not initialized');
    }
    return toAbsolutePath(relativePath, this.chromiumRoot);
  }

  // ==========================================
  // Helper Methods (node-sqlite3 API wrappers)
  // ==========================================

  /**
   * Execute SQL without returning results (INSERT, UPDATE, DELETE, CREATE, etc.)
   */
  private runAsync(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get a single row
   */
  private getAsync<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err: Error | null, row: T) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Get all rows
   */
  private allAsync<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: T[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  // ==========================================
  // File Queries (T029 partial)
  // ==========================================

  /**
   * Get file by path
   * @param filePath Absolute file path (will be converted to relative for query)
   * @returns File record with absolute paths or null if not found
   */
  public async getFile(filePath: string): Promise<IFile | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Convert to relative path for database query
    const relativePath = this.pathToRelative(filePath);
    const row = await this.getAsync<any>('SELECT * FROM files WHERE path = ?', [relativePath]);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      path: this.pathToAbsolute(row.path),
      type: row.type,
      mtime: row.mtime_ms,
      indexed_at: row.mtime_ms, // For backward compatibility
      lang: row.lang,
      parent_grd: row.parent_grd_path ? this.pathToAbsolute(row.parent_grd_path) : undefined,
    };
  }

  /**
   * Insert or update file record
   * @param file File with absolute paths (will be converted to relative for storage)
   */
  public async upsertFile(file: IFile): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Convert absolute paths to relative paths for storage
    const relativePath = this.pathToRelative(file.path);
    const relativeParentGrd = file.parent_grd ? this.pathToRelative(file.parent_grd) : null;

    await this.runAsync(
      `INSERT INTO files (path, mtime_ms, type, parent_grd_path, lang)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         mtime_ms = excluded.mtime_ms,
         type = excluded.type,
         parent_grd_path = excluded.parent_grd_path,
         lang = excluded.lang`,
      [relativePath, file.mtime, file.type, relativeParentGrd, file.lang || null],
    );
  }

  /**
   * Delete file record
   * @param filePath Absolute file path (will be converted to relative for query)
   */
  public async deleteFile(filePath: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const relativePath = this.pathToRelative(filePath);
    await this.runAsync('DELETE FROM files WHERE path = ?', [relativePath]);
  }

  // ==========================================
  // Message Queries (T030)
  // ==========================================

  /**
   * Get message by IDS name
   * @param name Message name (e.g., 'IDS_APP_TITLE')
   * @returns Message or null if not found
   */
  public async getMessageByName(name: string): Promise<IMessage | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const row = await this.getAsync<any>(
      `SELECT m.* FROM messages m
       JOIN message_names n ON n.id_hash = m.id_hash
       WHERE n.name = ?`,
      [name],
    );

    if (!row) {
      return null;
    }

    const message = this.rowToMessage(row);
    // Keep the requested IDS name to avoid mismatches when multiple names share the same id_hash
    message.name = name;
    return message;
  }

  /**
   * Get message by name and GRD file path
   * @param name IDS name (e.g., 'IDS_APP_TITLE')
   * @param grdPath GRD file path (absolute, will be converted to relative)
   * @returns Message or null if not found
   */
  public async getMessageByNameAndGrd(name: string, grdPath: string): Promise<IMessage | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const relativeGrdPath = this.pathToRelative(grdPath);

    const row = await this.getAsync<any>(
      `SELECT m.* FROM messages m
       JOIN message_names n ON n.id_hash = m.id_hash
       WHERE n.name = ? AND m.grd_path = ?`,
      [name, relativeGrdPath],
    );

    if (!row) {
      return null;
    }

    const message = this.rowToMessage(row);
    message.name = name;
    return message;
  }

  /**
   * Get message by name and GRDP file path
   * @param name IDS name (e.g., 'IDS_APP_TITLE')
   * @param grdpPath GRDP file path (absolute, will be converted to relative)
   * @returns Message or null if not found
   */
  public async getMessageByNameAndGrdp(name: string, grdpPath: string): Promise<IMessage | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const relativeGrdpPath = this.pathToRelative(grdpPath);

    const row = await this.getAsync<any>(
      `SELECT m.* FROM messages m
       JOIN message_names n ON n.id_hash = m.id_hash
       WHERE n.name = ? AND m.grdp_path = ?`,
      [name, relativeGrdpPath],
    );

    if (!row) {
      return null;
    }

    const message = this.rowToMessage(row);
    message.name = name;
    return message;
  }

  /**
   * Get message by hash ID
   * @param idHash Message hash ID
   * @returns Message or null if not found
   */
  public async getMessageByHash(idHash: string): Promise<IMessage | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const row = await this.getAsync<any>('SELECT * FROM messages WHERE id_hash = ?', [idHash]);

    if (!row) {
      return null;
    }

    return this.rowToMessage(row);
  }

  /**
   * Get all messages with a specific IDS name (across all GRD files)
   * Note: The same IDS name can appear in multiple GRD files with different id_hashes
   *
   * @param name IDS name (e.g., 'IDS_APP_TITLE')
   * @returns Array of messages (may be empty)
   */
  public async getMessagesByName(name: string): Promise<IMessage[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = await this.allAsync<any>(
      `SELECT m.* FROM messages m
       JOIN message_names n ON n.id_hash = m.id_hash
       WHERE n.name = ?`,
      [name],
    );

    return rows.map((row) => this.rowToMessage(row));
  }

  /**
   * Insert or update message record
   * @param message Message with absolute paths (will be converted to relative for storage)
   */
  public async upsertMessage(message: IMessage): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Convert absolute paths to relative paths for storage
    const relativeGrdPath = message.grd_path ? this.pathToRelative(message.grd_path) : null;
    const relativeGrdpPath = message.grdp_path ? this.pathToRelative(message.grdp_path) : null;

    await this.runAsync(
      `INSERT INTO messages (id_hash, name, english, presentable_text, desc, meaning, grd_path, grdp_path, start_line, end_line)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id_hash) DO UPDATE SET
         name = excluded.name,
         english = excluded.english,
         presentable_text = excluded.presentable_text,
         desc = excluded.desc,
         meaning = excluded.meaning,
         grd_path = excluded.grd_path,
         grdp_path = excluded.grdp_path,
         start_line = excluded.start_line,
         end_line = excluded.end_line`,
      [
        message.id_hash,
        message.name,
        message.english,
        message.presentable_text || message.english,
        message.description || null,
        message.meaning || null,
        relativeGrdPath,
        relativeGrdpPath,
        message.start_line || 0,
        message.end_line || 0,
      ],
    );

    // Maintain name->hash mapping so multiple IDS sharing a hash stay discoverable
    await this.runAsync(
      `INSERT INTO message_names (name, id_hash)
       VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET id_hash = excluded.id_hash`,
      [message.name, message.id_hash],
    );
  }

  /**
   * Delete messages by file path
   * @param filePath Absolute GRD or GRDP file path (will be converted to relative for query)
   */
  public async deleteMessagesByFile(filePath: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const relativePath = this.pathToRelative(filePath);
    await this.runAsync('DELETE FROM messages WHERE grd_path = ? OR grdp_path = ?', [
      relativePath,
      relativePath,
    ]);
  }

  /**
   * Delete messages by their hash IDs (used to remove messages no longer present after re-parse)
   * @param idHashes Array of message hash IDs
   */
  public async deleteMessagesByHash(idHashes: string[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (idHashes.length === 0) {
      return;
    }

    const placeholders = idHashes.map(() => '?').join(', ');
    await this.runAsync(`DELETE FROM messages WHERE id_hash IN (${placeholders})`, idHashes);
  }

  // ==========================================
  // Translation Queries (T031)
  // ==========================================

  /**
   * Get all translations for a message
   * @param idHash Message hash ID
   * @returns Array of translations
   */
  public async getTranslations(idHash: string): Promise<ITranslation[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = await this.allAsync<any>('SELECT * FROM translations WHERE id_hash = ?', [idHash]);
    return rows.map((row) => this.rowToTranslation(row));
  }

  /**
   * Get translation for a specific language
   * @param idHash Message hash ID
   * @param lang Language code
   * @returns Translation or null if not found
   */
  public async getTranslation(idHash: string, lang: string): Promise<ITranslation | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const row = await this.getAsync<any>(
      'SELECT * FROM translations WHERE id_hash = ? AND lang = ?',
      [idHash, lang],
    );

    if (!row) {
      return null;
    }

   return this.rowToTranslation(row);
  }

  /**
   * Insert or update translation record
   * @param translation Translation with absolute paths (will be converted to relative for storage)
   */
  public async upsertTranslation(
    translation: ITranslation,
    options?: { skipMessageCheck?: boolean; suppressOrphanLog?: boolean },
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Convert absolute path to relative path for storage
    const relativeXtbPath = translation.xtb_path ? this.pathToRelative(translation.xtb_path) : null;

    const { skipMessageCheck = false, suppressOrphanLog = false } = options || {};

    if (!skipMessageCheck) {
      // Check if the message exists before inserting translation
      // This prevents FOREIGN KEY constraint failures for orphan translations
      const messageExists = await this.getAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM messages WHERE id_hash = ?',
        [translation.id_hash],
      );

      if (!messageExists || messageExists.count === 0) {
        if (!suppressOrphanLog) {
          console.warn(
            `[QueryService] Skipping orphan relativeXtbPath: ${relativeXtbPath} translation: id_hash=${translation.id_hash} lang=${translation.lang} (no matching message)`,
          );
        }
        return;
      }
    }

    await this.runAsync(
      `INSERT INTO translations (id_hash, lang, text, xtb_path)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id_hash, lang) DO UPDATE SET
         text = excluded.text,
         xtb_path = excluded.xtb_path`,
      [translation.id_hash, translation.lang, translation.text, relativeXtbPath],
    );
  }

  /**
   * Delete translations by XTB file path
   * @param xtbPath Absolute XTB file path (will be converted to relative for query)
   */
  public async deleteTranslationsByFile(xtbPath: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const relativePath = this.pathToRelative(xtbPath);
    await this.runAsync('DELETE FROM translations WHERE xtb_path = ?', [relativePath]);
  }

  /**
   * Get all message ID hashes currently indexed
   * Useful for pre-validating translation imports
   */
  public async getAllMessageHashes(): Promise<Set<string>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = await this.allAsync<{ id_hash: string }>('SELECT id_hash FROM messages');
    return new Set(rows.map((row) => row.id_hash));
  }

  // ==========================================
  // Advanced Query Methods (T029-T031)
  // ==========================================

  /**
   * Get message with all its translations (T042)
   * @param idHash Message hash ID
   * @returns Message with translations array or null if not found
   */
  public async getMessageWithTranslations(
    idHash: string,
  ): Promise<IMessageWithTranslations | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const message = await this.getMessageByHash(idHash);
    if (!message) {
      return null;
    }

    const translations = await this.getTranslations(idHash);

    return {
      ...message,
      translations,
    };
  }

  /**
   * Get translations for multiple messages in batch (T050)
   * @param idHashes Array of message hash IDs
   * @param lang Language code
   * @returns Map of idHash to translation text
   */
  public async getTranslationsBatch(
    idHashes: string[],
    lang: string,
  ): Promise<Map<string, string>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (idHashes.length === 0) {
      return new Map();
    }

    const placeholders = idHashes.map(() => '?').join(',');
    const rows = await this.allAsync<any>(
      `SELECT id_hash, text FROM translations WHERE id_hash IN (${placeholders}) AND lang = ?`,
      [...idHashes, lang],
    );

    const result = new Map<string, string>();
    for (const row of rows) {
      result.set(row.id_hash, row.text);
    }

    return result;
  }

  /**
   * Search messages by IDS name (prefix preferred), English text, or translation text (T064)
   * @param keyword Search keyword (partial IDS name or free text)
   * @param limit Maximum results to return
   * @param offset Result offset for pagination
   * @returns Search result with total count
   */
  public async searchMessages(
    keyword: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<ISearchResult> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const trimmedKeyword = (keyword || '').trim();
    const hasKeyword = trimmedKeyword.length > 0;
    const safeLimit = Math.max(1, limit || 0);
    const safeOffset = Math.max(0, offset || 0);

    // Prefer prefix matching for IDS names while still allowing fuzzy text search
    const normalizedPrefix = trimmedKeyword.toUpperCase();
    const prefixPattern = `${normalizedPrefix}%`;
    const fuzzyPattern = `%${trimmedKeyword}%`;

    const whereClause = hasKeyword
      ? `(
          n.name LIKE ?
          OR m.english LIKE ? COLLATE NOCASE
          OR EXISTS (
            SELECT 1 FROM translations t
            WHERE t.id_hash = m.id_hash AND t.text LIKE ? COLLATE NOCASE
          )
        )`
      : '1=1';

    const countParams = hasKeyword ? [prefixPattern, fuzzyPattern, fuzzyPattern] : [];
    const totalRow = await this.getAsync<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM message_names n
       JOIN messages m ON m.id_hash = n.id_hash
       WHERE ${whereClause}`,
      countParams,
    );

    const orderBy = hasKeyword ? 'CASE WHEN n.name LIKE ? THEN 0 ELSE 1 END, n.name' : 'n.name';
    const rows = await this.allAsync<any>(
      `SELECT n.name AS alias_name, m.*
       FROM message_names n
       JOIN messages m ON m.id_hash = n.id_hash
       WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      hasKeyword
        ? [prefixPattern, fuzzyPattern, fuzzyPattern, prefixPattern, safeLimit, safeOffset]
        : [safeLimit, safeOffset],
    );

    // Fetch translations in batch for all matched messages
    const idHashes = Array.from(new Set(rows.map((row) => row.id_hash)));
    const translationsByHash = new Map<string, ITranslation[]>();

    if (idHashes.length > 0) {
      const placeholders = idHashes.map(() => '?').join(',');
      const translationRows = await this.allAsync<any>(
        `SELECT * FROM translations WHERE id_hash IN (${placeholders})`,
        idHashes,
      );

      for (const row of translationRows) {
        const translation = this.rowToTranslation(row);
        const bucket = translationsByHash.get(row.id_hash) || [];
        bucket.push(translation);
        translationsByHash.set(row.id_hash, bucket);
      }
    }

    const messages: IMessageWithTranslations[] = rows.map((row) => {
      const message = this.rowToMessage(row);
      message.name = row.alias_name || message.name;

      return {
        ...message,
        translations: translationsByHash.get(message.id_hash) || [],
      };
    });

    return {
      messages,
      total: totalRow?.count || 0,
    };
  }

  /**
   * Get translation statistics for all languages (T067)
   * @returns Array of translation statistics by language
   */
  public async getTranslationStats(): Promise<ITranslationStats[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const totalRow = await this.getAsync<{ count: number }>(
      'SELECT COUNT(DISTINCT id_hash) as count FROM messages',
    );
    const totalMessages = totalRow?.count ?? 0;

    // Collect languages from XTB files and existing translations to include empty languages
    const rows = await this.allAsync<any>(`
      WITH langs AS (
        SELECT DISTINCT lang FROM files WHERE type = 'xtb' AND lang IS NOT NULL
        UNION
        SELECT DISTINCT lang FROM translations WHERE lang IS NOT NULL
      ),
      translated AS (
        SELECT lang, COUNT(DISTINCT id_hash) AS translated_count
        FROM translations
        WHERE lang IS NOT NULL
        GROUP BY lang
      )
      SELECT
        l.lang,
        COALESCE(t.translated_count, 0) AS translated_count
      FROM langs l
      LEFT JOIN translated t ON t.lang = l.lang
      ORDER BY l.lang
    `);

    if (totalMessages === 0) {
      return rows.map((row) => ({
        lang: row.lang,
        total_messages: 0,
        translated_count: row.translated_count,
        missing_count: 0,
        coverage: 0,
      }));
    }

    return rows.map((row) => {
      const translated = row.translated_count || 0;
      const missing = Math.max(totalMessages - translated, 0);
      const coverage = Math.min(100, (translated * 100) / totalMessages);

      return {
        lang: row.lang,
        total_messages: totalMessages,
        translated_count: translated,
        missing_count: missing,
        coverage,
      };
    });
  }

  /**
   * Get all messages from a specific file (T068)
   * @param filePath GRD or GRDP file path
   * @returns Array of messages from the file
   */
  public async getMessagesByFile(filePath: string): Promise<IMessage[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const relativePath = this.pathToRelative(filePath);
    const rows = await this.allAsync<any>(
      'SELECT * FROM messages WHERE grd_path = ? OR grdp_path = ?',
      [relativePath, relativePath],
    );

    return rows.map((row) => this.rowToMessage(row));
  }

  /**
   * Get message counts grouped by source file (GRD or GRDP)
   * @returns Map of absolute file path to message count
   */
  public async getMessageCountsByFile(): Promise<Map<string, number>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = await this.allAsync<any>(`
      SELECT grd_path AS path, COUNT(*) AS count
      FROM messages
      GROUP BY grd_path
      UNION ALL
      SELECT grdp_path AS path, COUNT(*) AS count
      FROM messages
      WHERE grdp_path IS NOT NULL
      GROUP BY grdp_path
    `);

    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.path) {
        continue;
      }
      counts.set(this.pathToAbsolute(row.path), row.count || 0);
    }

    return counts;
  }

  /**
   * Find messages missing translations for a language (T069)
   * @param lang Language code
   * @returns Array of messages without translations in the specified language
   */
  public async findMissingTranslations(lang: string): Promise<IMessage[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = await this.allAsync<any>(
      `SELECT m.* FROM messages m
       WHERE NOT EXISTS (
         SELECT 1 FROM translations t
         WHERE t.id_hash = m.id_hash AND t.lang = ?
       )
       ORDER BY m.name`,
      [lang],
    );

    return rows.map((row) => this.rowToMessage(row));
  }

  /**
   * Find translations without corresponding messages (T076)
   * @returns Array of orphan translations
   */
  public async findOrphanTranslations(): Promise<ITranslation[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = await this.allAsync<any>(`
      SELECT t.* FROM translations t
      WHERE NOT EXISTS (
        SELECT 1 FROM messages m WHERE m.id_hash = t.id_hash
      )
      ORDER BY t.lang, t.id_hash
    `);

    return rows.map((row) => this.rowToTranslation(row));
  }

  /**
   * Get all GRD files
   * @returns Array of GRD file records with absolute paths
   */
  public async getAllGRDFiles(): Promise<IFile[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = await this.allAsync<any>("SELECT * FROM files WHERE type = 'grd' ORDER BY path");

    return rows.map((row) => ({
      id: row.id,
      path: this.pathToAbsolute(row.path),
      type: row.type,
      mtime: row.mtime_ms,
      indexed_at: row.mtime_ms,
      lang: row.lang,
      parent_grd: row.parent_grd_path ? this.pathToAbsolute(row.parent_grd_path) : undefined,
    }));
  }

  /**
   * Get all available languages from XTB files
   * @returns Array of unique language codes sorted alphabetically
   */
  public async getAllLanguages(): Promise<string[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = await this.allAsync<any>(
      "SELECT DISTINCT lang FROM files WHERE type = 'xtb' AND lang IS NOT NULL ORDER BY lang"
    );

    return rows.map((row) => row.lang);
  }

  /**
   * Get all files (for index rebuild)
   * @returns Array of all file records with absolute paths
   */
  public async getAllFiles(): Promise<IFile[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = await this.allAsync<any>('SELECT * FROM files ORDER BY type, path');

    return rows.map((row) => ({
      id: row.id,
      path: this.pathToAbsolute(row.path),
      type: row.type,
      mtime: row.mtime_ms,
      indexed_at: row.mtime_ms,
      lang: row.lang,
      parent_grd: row.parent_grd_path ? this.pathToAbsolute(row.parent_grd_path) : undefined,
    }));
  }

  /**
   * Get index statistics (file counts and message counts)
   * @returns Statistics object
   */
  public async getIndexStats(): Promise<{
    grdCount: number;
    grdpCount: number;
    xtbCount: number;
    messageCount: number;
    translationCount: number;
  }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const fileStats = await this.getAsync<any>(`
      SELECT
        SUM(CASE WHEN type = 'grd' THEN 1 ELSE 0 END) as grd_count,
        SUM(CASE WHEN type = 'grdp' THEN 1 ELSE 0 END) as grdp_count,
        SUM(CASE WHEN type = 'xtb' THEN 1 ELSE 0 END) as xtb_count
      FROM files
    `);

    const messageCount = await this.getAsync<any>('SELECT COUNT(*) as count FROM messages');
    const translationCount = await this.getAsync<any>('SELECT COUNT(*) as count FROM translations');

    return {
      grdCount: fileStats?.grd_count || 0,
      grdpCount: fileStats?.grdp_count || 0,
      xtbCount: fileStats?.xtb_count || 0,
      messageCount: messageCount?.count || 0,
      translationCount: translationCount?.count || 0,
    };
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  /**
   * Convert database row to IMessage
   * Converts relative paths back to absolute paths
   */
  private rowToMessage(row: any): IMessage {
    return {
      id: row.id,
      name: row.name,
      english: row.english,
      meaning: row.meaning,
      description: row.desc,
      id_hash: row.id_hash,
      grd_path: row.grd_path ? this.pathToAbsolute(row.grd_path) : undefined,
      grdp_path: row.grdp_path ? this.pathToAbsolute(row.grdp_path) : undefined,
      start_line: row.start_line,
      end_line: row.end_line,
      presentable_text: row.presentable_text,
    };
  }

  /**
   * Convert database row to ITranslation
   * Converts relative paths back to absolute paths
   */
  private rowToTranslation(row: any): ITranslation {
    return {
      id: row.id,
      id_hash: row.id_hash,
      lang: row.lang,
      text: row.text,
      xtb_path: row.xtb_path ? this.pathToAbsolute(row.xtb_path) : '',
      start_line: row.start_line,
    };
  }

  // ==========================================
  // Index Progress Management Methods
  // ==========================================

  /**
   * Get current index progress status
   * @returns Index progress record or null if not exists
   */
  public async getIndexProgress(): Promise<{
    status: 'idle' | 'indexing' | 'completed' | 'cancelled';
    total_files: number;
    processed_count: number;
    start_time: number | null;
    last_update_time: number | null;
  } | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const row = await this.getAsync('SELECT * FROM index_progress WHERE id = 1');
    return row || null;
  }

  /**
   * Update index progress
   * Creates record if not exists (id=1 singleton)
   */
  public async updateIndexProgress(data: {
    status?: 'idle' | 'indexing' | 'completed' | 'cancelled';
    total_files?: number;
    processed_count?: number;
    start_time?: number;
    last_update_time?: number;
  }): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Check if record exists
    const existing = await this.getAsync('SELECT id FROM index_progress WHERE id = 1');

    if (existing) {
      // Update existing record
      const fields: string[] = [];
      const values: any[] = [];

      if (data.status !== undefined) {
        fields.push('status = ?');
        values.push(data.status);
      }
      if (data.total_files !== undefined) {
        fields.push('total_files = ?');
        values.push(data.total_files);
      }
      if (data.processed_count !== undefined) {
        fields.push('processed_count = ?');
        values.push(data.processed_count);
      }
      if (data.start_time !== undefined) {
        fields.push('start_time = ?');
        values.push(data.start_time);
      }
      if (data.last_update_time !== undefined) {
        fields.push('last_update_time = ?');
        values.push(data.last_update_time);
      }

      if (fields.length > 0) {
        const sql = `UPDATE index_progress SET ${fields.join(', ')} WHERE id = 1`;
        await this.runAsync(sql, values);
      }
    } else {
      // Insert new record
      await this.runAsync(
        `INSERT INTO index_progress (id, status, total_files, processed_count, start_time, last_update_time)
         VALUES (1, ?, ?, ?, ?, ?)`,
        [
          data.status || 'idle',
          data.total_files || 0,
          data.processed_count || 0,
          data.start_time || null,
          data.last_update_time || null,
        ],
      );
    }
  }

  /**
   * Mark a GRD file as processed
   * @param grdPath Absolute GRD file path
   */
  public async markFileAsProcessed(grdPath: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const relativePath = this.pathToRelative(grdPath);
    await this.runAsync(
      'INSERT OR REPLACE INTO index_processed_files (grd_path, processed_at) VALUES (?, ?)',
      [relativePath, Date.now()],
    );
  }

  /**
   * Get all processed GRD file paths
   * @returns Array of absolute GRD file paths
   */
  public async getProcessedFiles(): Promise<string[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = await this.allAsync('SELECT grd_path FROM index_processed_files ORDER BY processed_at');
    return rows.map((row: any) => this.pathToAbsolute(row.grd_path));
  }

  /**
   * Clear all processed files records
   * Used when starting a new full index or after completion
   */
  public async clearProcessedFiles(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    await this.runAsync('DELETE FROM index_processed_files');
  }

  /**
   * Increment processed count by 1
   * Updates last_update_time as heartbeat
   */
  public async incrementProcessedCount(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    await this.runAsync(
      `UPDATE index_progress
       SET processed_count = processed_count + 1,
           last_update_time = ?
       WHERE id = 1`,
      [Date.now()],
    );
  }
}

// Export singleton instance getter
export const getQueryService = () => QueryService.getInstance();
