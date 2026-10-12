// The founder decided (2026-10-12) that the app has no admin login: every visitor can use every control.
// These two helpers remain so the pages and actions that used to check for admin keep one place to change
// if a login is ever wanted again. Nothing here sends anything; the only automatic email is still the Monday brief.

export async function isAdmin(): Promise<boolean> {
  return true;
}

export async function requireAdmin(): Promise<void> {}
