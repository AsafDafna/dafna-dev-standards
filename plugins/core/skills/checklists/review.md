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

One line per finding: `[severity] file:line — issue and why it matters. Fix.`

Severity levels:
- **critical** - must fix before merge
- **major** - should fix, significant impact
- **minor** - nice to fix, low impact
- **suggestion** - optional improvement

## Summary
- Verdict: ready to merge, or not ready.
- The critical and major findings.
- A count of the minor findings and suggestions.
