# Code Review Checklist

Use this checklist to ensure high-quality code reviews. Focus on the most impactful issues first.

## 1. Logic & Correctness
- **Completeness:** Does the code fulfill all requirements?
- **Edge Cases:** Are empty states, null values, or unusual inputs handled?
- **Off-by-one Errors:** Check loops and array indexing.
- **Race Conditions:** Look for shared state in asynchronous code.
- **Type Safety:** Are types correctly defined and used?

## 2. Security
- **Input Validation:** Is all user input sanitized and validated?
- **Authentication:** Are sensitive endpoints protected?
- **Secrets:** Check for hardcoded keys, passwords, or tokens.
- **Data Privacy:** Is sensitive data handled and stored securely?
- **Vulnerabilities:** Look for common issues like SQL injection, XSS, and insecure defaults.

## 3. Performance
- **Efficiency:** Are there unnecessary loops or redundant calculations?
- **Resource Usage:** Check for memory leaks or large unneeded allocations.
- **Database Access:** Are queries optimized? Look for N+1 issues.
- **Concurrency:** Is work parallelized effectively where appropriate?

## 4. Style & Maintainability
- **Readability:** Is the code easy to understand? Are names descriptive?
- **Structure:** Is the logic well-organized? Is it DRY (Don't Repeat Yourself)?
- **Comments:** Do comments explain *why* (not just what)?
- **Testing:** Are there tests for new logic? Do existing tests still pass?
- **Documentation:** Are APIs or complex modules documented?

## 5. Project Standards
- **GEMINI.md Adherence:** Does the code align with the project's foundational mandates?
- **Conventions:** Does it follow established naming and formatting patterns?
- **Dependencies:** Are new dependencies justified and correctly added?
