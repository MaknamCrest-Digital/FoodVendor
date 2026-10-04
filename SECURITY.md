# Security

- Backend derives authorized tenant scope from authenticated identity/device; never trust arbitrary client `business_id` for access.
- Short-lived access tokens + refresh strategy before production.
- Role checks: ADMIN, MANAGER, CASHIER, KITCHEN.
- Cashiers cannot delete completed sales.
- Refund/void requires manager authorization and reason.
- Audit privileged actions.
- HTTPS only in production.
- Secrets stay in environment/secret manager, never frontend source.
- Local device data should use OS-protected storage/encryption where practical.
- Rate limit auth/sensitive endpoints before public rollout.
