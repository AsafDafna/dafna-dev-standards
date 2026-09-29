# Testing Checklist

Before adding or changing a test, pass the authoring gate in the `test-audit`
skill; use that skill, not this list, to judge whether an existing test is
worth keeping. This checklist covers what to test, not whether a test earns
its place.

## Test Categories

### Unit Tests
- Individual functions/components in isolation
- Mock external dependencies
- Test happy path and error cases
- Test boundary conditions

### Integration Tests
- Component interactions
- API endpoint testing
- Database operations with RLS
- Authentication flows

### Edge Cases to Consider
- Empty inputs
- Null/undefined values
- Maximum/minimum values
- Invalid data types
- Concurrent operations
- Network failures
- Permission denied scenarios

## Test Structure
1. Group related tests with `describe` blocks
2. Use clear test names that describe the scenario
3. Follow Arrange-Act-Assert pattern
4. Keep tests independent (no shared state)

## Conventions
- Location: same directory or `__tests__/` folder
- Naming: `[component].test.ts` or `[component].spec.ts`
- Include setup and teardown when needed
