# Security Review Patterns

This reference provides specific patterns to look for during a security-focused code review.

## 1. Input Validation & Sanitization
- **Issue:** Untrusted user input can lead to injection attacks (SQL, XSS, Command Injection).
- **Remediation:** Always use parameterized queries for DB access. Sanitize data before rendering it in HTML or using it in shell commands. Use schema validation (e.g., Joi, Zod) for API requests.

## 2. Secrets Management
- **Issue:** Hardcoded credentials (API keys, passwords, private keys) are easily leaked.
- **Remediation:** Use environment variables or secret management tools. Ensure sensitive files (e.g., `.env`, `.pem`) are in `.gitignore`.

## 3. Authentication & Authorization
- **Issue:** Improperly protected endpoints allow unauthorized access to sensitive data or actions.
- **Remediation:** Verify that every sensitive action requires authentication. Check that authorized users only have access to their own data (IDOR - Insecure Direct Object Reference).

## 4. Insecure Defaults & Misconfigurations
- **Issue:** Default settings or weak configurations can expose the system.
- **Remediation:** Use strong encryption (e.g., bcrypt for passwords). Disable unnecessary features or debug modes in production. Use secure HTTP headers (e.g., HSTS, CSP).

## 5. Dependencies
- **Issue:** Third-party libraries can have known vulnerabilities.
- **Remediation:** Regularly audit dependencies (e.g., `npm audit`, `cargo audit`). Prefer well-maintained libraries with a clear security track record.

## 6. Error Handling & Information Disclosure
- **Issue:** Verbose error messages can leak system details to attackers.
- **Remediation:** Catch all exceptions. Use generic error messages for end-users while logging detailed information for developers.
