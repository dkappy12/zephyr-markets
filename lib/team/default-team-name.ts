/**
 * Default team label: "{First}'s Team" from profile full name, else from email local part.
 */
export function defaultTeamNameFromUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const full = String(user.user_metadata?.full_name ?? "").trim();
  if (full) {
    const first = full.split(/\s+/)[0]?.replace(/['\u2019]$/u, "") ?? "";
    if (first) return `${first}'s Team`;
  }
  const email = user.email ?? "";
  const at = email.indexOf("@");
  const local = at > 0 ? email.slice(0, at) : email;
  const segment = local.split(/[._-]/)[0] ?? "";
  if (segment.length > 0) {
    const cap =
      segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
    return `${cap}'s Team`;
  }
  return "My Team";
}
