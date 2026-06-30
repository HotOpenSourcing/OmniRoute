<!-- copilot-context-manager:begin -->
<!-- Active context: General Development — updated 2026-06-30T00:40:46.000Z -->

You are an expert software engineer. Follow these principles:

- Write clean, maintainable, and well-documented code
- Include comprehensive tests for new functionality
- Follow language-specific best practices and idioms
- Consider edge cases and error handling
- Optimize for readability and maintainability
- Use meaningful variable and function names

Project: OmniRoute

<!-- copilot-context-manager:end -->

# OmniRoute PR and Coverage Instructions

- Treat `npm run test:coverage` as a required gate for PR work.
- The repository minimum is `60%` for statements, lines, functions, and branches.
- If a PR changes production code in `src/`, `open-sse/`, `electron/`, or `bin/`, it must include automated tests in the same PR.
- When reviewing or updating a PR, if the report shows missing tests or coverage below `60%`, do not stop after reporting the problem. Add or update tests in the PR first, rerun the coverage gate, and only then ask for confirmation.
- Prefer the smallest test layer that proves the behavior:
  - unit tests first
  - integration tests when multiple modules or DB state are involved
  - e2e only when the behavior is truly UI or workflow-dependent
- For bug issues, try to encode the reproduction as an automated test before or alongside the fix.
- In the final PR report, include:
  - the commands you ran
  - the changed test files
  - the final coverage result
