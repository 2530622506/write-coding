# Errors

Command failures and integration errors.

---

- 2026-10-24: `maestro explore` crashed under Node 20.20.0 in bundled `undici` (`webidl.util.markAsUncloneable is not a function`); retry with Node 22 before falling back to direct read-only search.
- 2026-10-24: Initial S3 smoke test returned 403 because the supplied `admin` credentials did not match the already-running RustFS container. Verified the active container uses `rustfsadmin` for both keys; changed local `.env` to match the selected Docker configuration before retesting.
