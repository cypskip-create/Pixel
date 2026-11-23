/**
 * Static security scanner for Hermes-inspired procedural SKILL.md playbooks.
 *
 * Defense in depth: a clean static scan is necessary for activation, never
 * sufficient to bypass runtime PermissionBroker checks.
 */

export interface SkillSecurityFinding {
  severity: 'high' | 'medium';
  rule: string;
  message: string;
}

export interface SkillSecurityScanResult {
  status: 'clean' | 'warning' | 'blocked';
  findings: SkillSecurityFinding[];
}

interface ScanRule {
  id: string;
  severity: 'high' | 'medium';
  pattern: RegExp;
  message: string;
}

const SCAN_RULES: readonly ScanRule[] = [
  {
    id: 'prompt-injection-override',
    severity: 'high',
    pattern: /\b(?:ignore|disregard|override|bypass|forget)\s+(?:all\s+)?(?:previous|prior|above|system|safety|permission)\s+(?:instructions?|rules?|checks?|prompts?)\b/i,
    message: 'Contains instruction-override or safety-bypass phrasing.',
  },
  {
    id: 'credential-exfiltration',
    severity: 'high',
    pattern: /\b(?:deepseek\.key|github\.key|id_rsa|id_ed25519|\.ssh\/|safeStorage|api[_ -]?key|access[_ -]?token)\b[\s\S]{0,80}\b(?:send|post|upload|exfiltrate|curl|wget|fetch|http)\b/i,
    message: 'Appears to combine credential/key access with outbound network transmission.',
  },
  {
    id: 'destructive-shell',
    severity: 'high',
    pattern: /\b(?:rm\s+-rf\s+\/|del\s+\/[sqf]+|format\s+[a-z]:|git\s+push\s+--force|git\s+reset\s+--hard\s+HEAD~|powershell\s+-e(?:nc|ncodedcommand)?)\b/i,
    message: 'Contains destructive or obfuscated shell command instructions.',
  },
  {
    id: 'path-traversal',
    severity: 'high',
    pattern: /(?:^|[\s("'`])(?:\.\.[/\\]){1,}/,
    message: 'Contains relative parent-directory path traversal (../).',
  },
  {
    id: 'invisible-unicode',
    severity: 'high',
    pattern: /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/,
    message: 'Contains hidden zero-width or directional Unicode characters.',
  },
  {
    id: 'raw-secret-literal',
    severity: 'high',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/,
    message: 'Contains a literal secret or API token.',
  },
  {
    id: 'external-script-fetch',
    severity: 'medium',
    pattern: /\b(?:curl|wget|Invoke-WebRequest)\b[\s\S]{0,80}\|\s*(?:sh|bash|pwsh|powershell|python)/i,
    message: 'Instructs piping a remote download directly into an interpreter.',
  },
  {
    id: 'permission-escalation-claim',
    severity: 'medium',
    pattern: /\b(?:skip|disable|turn off)\s+(?:user\s+)?(?:approval|confirmation|permission)\b/i,
    message: 'Requests skipping user approval or permission checks.',
  },
];

export function scanProceduralSkillMarkdown(markdown: string): SkillSecurityScanResult {
  const findings: SkillSecurityFinding[] = [];
  for (const rule of SCAN_RULES) {
    if (rule.pattern.test(markdown)) {
      findings.push({
        severity: rule.severity,
        rule: rule.id,
        message: rule.message,
      });
    }
  }
  const hasHigh = findings.some((f) => f.severity === 'high');
  const status: SkillSecurityScanResult['status'] = hasHigh
    ? 'blocked'
    : findings.length > 0
      ? 'warning'
      : 'clean';
  return { status, findings };
}
