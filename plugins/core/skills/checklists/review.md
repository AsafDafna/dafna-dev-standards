# Code Review Checklist

## Review Categories

### Bugs & Logic Errors
- Edge cases not handled
- Race conditions
- Null/undefined risks
- Type mismatches

### Security Issues
- Input validation
- Authentication/authorization gaps
- Data exposure risks
- Injection vulnerabilities

### Code Quality
- Naming clarity
- Function/component size
- DRY violations
- Error handling

### Simplification Opportunities
- Overly complex logic that can be simplified
- Redundant code
- Better patterns or utilities available
- Unnecessary abstractions

## Finding Format

**[SEVERITY] Issue Title**
- Location: `file:line`
- Issue: Description
- Why it matters: Impact explanation
- Suggestion: How to fix

Severity levels:
- **CRITICAL** - Must fix before merge
- **MAJOR** - Should fix, significant impact
- **MINOR** - Nice to fix, low impact
- **SUGGESTION** - Optional improvement

## Summary Template
- Ready to merge? Yes / No / With fixes
- Main concerns
- Positive observations
