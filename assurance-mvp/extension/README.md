# Extension MVP

This extension uses a main-world `fetch`/XHR wrapper for the actual transformation and an isolated-world bridge for communication with the local assurance service.

It intentionally avoids DOM selectors for individual AI products.

### Security behavior

- Service unavailable -> submission blocked.
- Unknown body type -> submission blocked.
- Oversized body -> submission blocked.
- Unsupported binary file -> submission blocked.
- Sensitive text -> pseudonymized locally.
- Clean text -> transmitted unchanged.
- The page never receives the token vault.
