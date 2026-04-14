const MIN_PASSWORD_LENGTH = 12;

export type PasswordPolicyResult = {
  ok: boolean;
  reasons: string[];
};

export function validatePasswordPolicy(input: string): PasswordPolicyResult {
  const password = input ?? "";
  const reasons: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    reasons.push(`Must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (!/[A-Z]/.test(password)) reasons.push("Must include an uppercase letter.");
  if (!/[a-z]/.test(password)) reasons.push("Must include a lowercase letter.");
  if (!/[0-9]/.test(password)) reasons.push("Must include a number.");
  if (!/[^A-Za-z0-9]/.test(password)) {
    reasons.push("Must include a special character.");
  }
  return { ok: reasons.length === 0, reasons };
}

export function passwordPolicyHint() {
  return "At least 12 characters, with uppercase, lowercase, number, and special character.";
}
