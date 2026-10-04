# Infrastructure
Local development uses Docker Compose. Production target should separate managed PostgreSQL, API runtime and web hosting. Require HTTPS, secrets manager/environment secrets, automated backups/PITR, logs/metrics and staging before pilot production. Do not deploy the SQLite dev database to production.
