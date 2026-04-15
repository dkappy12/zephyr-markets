/** Two-letter initials from full name when available (e.g. Dean Kaplan → DK). */
export function initialsFromUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
} | null): string {
  if (!user) return "U";
  const name = String(user.user_metadata?.full_name ?? "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const a = parts[0]?.charAt(0) ?? "";
      const b = parts[parts.length - 1]?.charAt(0) ?? "";
      return (a + b).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (parts[0]) return parts[0].charAt(0).toUpperCase();
  }
  const email = user.email ?? "";
  const local = email.split("@")[0] ?? "";
  if (local.length >= 2) return local.slice(0, 2).toUpperCase();
  return (local.charAt(0) || "U").toUpperCase();
}
