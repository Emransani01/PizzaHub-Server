export interface PasswordCheck {
  valid: boolean;
  issues: string[];
}

/**
 * Assignment rule: at least 6 characters with both an uppercase and a
 * lowercase letter. Enforced on the server, mirrored in the client form.
 */
export function checkPasswordStrength(password: string): PasswordCheck {
  const issues: string[] = [];
  if (password.length < 6) {
    issues.push("Password must be at least 6 characters long.");
  }
  if (!/[A-Z]/.test(password)) {
    issues.push("Password must contain an uppercase letter.");
  }
  if (!/[a-z]/.test(password)) {
    issues.push("Password must contain a lowercase letter.");
  }
  return { valid: issues.length === 0, issues };
}
