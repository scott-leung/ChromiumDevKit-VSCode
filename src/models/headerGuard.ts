/**
 * Header guard macro structure
 */
export interface HeaderGuard {
  /** Macro name (e.g., "BROWSER_ACCOUNT_TEST_H_") */
  macroName: string;

  /** #ifndef line (e.g., "#ifndef BROWSER_ACCOUNT_TEST_H_") */
  ifndef: string;

  /** #define line (e.g., "#define BROWSER_ACCOUNT_TEST_H_") */
  define: string;

  /** #endif line with comment (e.g., "#endif  // BROWSER_ACCOUNT_TEST_H_") */
  endif: string;
}
