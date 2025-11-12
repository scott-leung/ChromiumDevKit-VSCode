import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Git configuration reader utility
 */
export class GitUtils {
  private static gitConfigCache: { name?: string; email?: string } = {};
  private static cacheInitialized = false;

  /**
   * Execute git config command safely
   * @param configKey Git config key to read (e.g., 'user.name', 'user.email')
   * @returns Config value or undefined if not found or git is unavailable
   */
  private static async getGitConfig(configKey: string): Promise<string | undefined> {
    try {
      const { stdout } = await execPromise(`git config --get ${configKey}`);
      const value = stdout.trim();
      return value || undefined;
    } catch (error) {
      // Git command failed - either git is not installed, config key doesn't exist, or other error
      return undefined;
    }
  }

  /**
   * Get git user name from git config
   * @returns User name from git config, or undefined if not available
   */
  public static async getGitUserName(): Promise<string | undefined> {
    if (!this.cacheInitialized) {
      await this.initializeCache();
    }
    return this.gitConfigCache.name;
  }

  /**
   * Get git user email from git config
   * @returns User email from git config, or undefined if not available
   */
  public static async getGitUserEmail(): Promise<string | undefined> {
    if (!this.cacheInitialized) {
      await this.initializeCache();
    }
    return this.gitConfigCache.email;
  }

  /**
   * Initialize git config cache by reading from git
   * This is called automatically on first access
   */
  private static async initializeCache(): Promise<void> {
    try {
      const [name, email] = await Promise.all([
        this.getGitConfig('user.name'),
        this.getGitConfig('user.email'),
      ]);

      this.gitConfigCache = { name, email };
      this.cacheInitialized = true;
    } catch (error) {
      // Failed to read git config - cache remains empty
      this.gitConfigCache = {};
      this.cacheInitialized = true;
    }
  }

  /**
   * Clear the git config cache
   * Useful for testing or when git config might have changed
   */
  public static clearCache(): void {
    this.gitConfigCache = {};
    this.cacheInitialized = false;
  }
}
