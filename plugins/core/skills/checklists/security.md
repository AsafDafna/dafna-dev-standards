# Security Audit Checklist

## Authentication
- Auth required for sensitive operations?
- Session management secure?
- Password handling follows best practices?
- MFA considered for sensitive actions?

## Authorization
- Role checks implemented correctly?
- Can users access others' data?
- Admin functions protected?
- API endpoints properly secured?

## Data Protection
- Sensitive data encrypted at rest?
- Secure transmission (HTTPS)?
- PII handled appropriately?
- Secrets not hardcoded?

## Input Validation
- All inputs validated?
- SQL injection prevented?
- XSS prevented?
- File upload restrictions?

## Stack-specific (Supabase/Postgres — skip if not applicable)
- RLS policies in place for all tables?
- INSERT/UPDATE policies have `WITH CHECK`? (not just `USING`)
- Service role key not exposed to client?
- Anon key permissions appropriate?
- `SECURITY DEFINER` functions have `SET search_path = ''` + fully-qualified names?
- Extensions installed in `extensions` schema (not `public`)?
- Run Security Advisor after DDL changes (Dashboard or `mcp__supabase__get_advisors`)?

## Finding Format

**[SEVERITY] Vulnerability Title**
- Type: OWASP category
- Location: `file:line` or component
- Risk: What could happen if exploited
- Remediation: How to fix
- Priority: Immediate / High / Medium / Low

## Summary
- Critical issues count
- Overall security posture
- Recommended next steps
