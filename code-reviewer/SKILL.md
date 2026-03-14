---
name: code-reviewer
description: Expert code review for logic, security, performance, and style. Use when the user requests a review of a PR, a specific file, or a code snippet to ensure it meets quality standards and aligns with project mandates (like GEMINI.md).
---

# Code Reviewer

## Overview

The `code-reviewer` skill provides a structured approach to analyzing code changes. It focuses on identifying bugs, security vulnerabilities, performance bottlenecks, and inconsistencies with established project standards.

## Workflow

When performing a code review, follow this sequential process:

1. **Context Gathering:** 
   - Read the project's `GEMINI.md` to understand foundational mandates and style guides.
   - Review any relevant PR descriptions or issue comments.
2. **Analysis:** 
   - Apply the [Code Review Checklist](references/checklist.md) to the code changes.
   - For security-sensitive code, use the [Security Review Patterns](references/security-patterns.md).
3. **Synthesis:** 
   - Group feedback by category (e.g., Critical Bug, Security, Improvement, Nit).
   - Provide clear explanations for *why* a change is suggested.
   - Include code examples for complex suggestions.
4. **Validation:** 
   - Ensure the suggested changes don't introduce new issues or break existing tests.

## Feedback Categories

- **🔴 Critical:** Logic bugs, security vulnerabilities, or major performance regressions. Must be addressed.
- **🟡 Improvement:** Better ways to implement the same logic, improved readability, or minor optimizations.
- **🟢 Nit:** Cosmetic changes, minor style inconsistencies, or documentation improvements.
- **🔵 Question:** Clarification needed on intent or implementation details.

## Example Request

User: "Can you review this new authentication module I just added?"

Response: "I will review the authentication module for logic, security, and performance, ensuring it aligns with the project's mandates in `GEMINI.md`..."
