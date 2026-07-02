/**
 * Utility to prefix application paths with the configured basePath.
 *
 * Next.js Link and router.push automatically prepend basePath, but raw
 * `<a href>` and `window.open()` do not. Use this helper for those cases.
 */

const BASE_PATH =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_PATH) || "";

/**
 * Prepend the application basePath to a given path.
 *
 * - If the path already starts with the basePath, it is returned unchanged.
 * - External URLs (http/https) are returned unchanged.
 * - Relative paths (not starting with "/") get a "/" prepended before the basePath.
 *
 * @example
 * // NEXT_PUBLIC_BASE_PATH = "/tide"
 * appPath("/tasks/123")        // → "/tide/tasks/123"
 * appPath("/docs/view?url=x")  // → "/tide/docs/view?url=x"
 * appPath("https://foo.com")   // → "https://foo.com"
 */
export function appPath(path: string): string {
  if (!path) return BASE_PATH || "/";
  // External URLs — no prefix
  if (/^https?:\/\//i.test(path)) return path;
  // Already prefixed — no double prefix
  if (BASE_PATH && path.startsWith(BASE_PATH + "/")) return path;
  if (BASE_PATH && path === BASE_PATH) return path;
  // Ensure leading slash
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${normalized}`;
}
