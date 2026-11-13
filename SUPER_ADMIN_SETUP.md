# Super Admin live setup

The platform-owner console is already wired to the existing PostgreSQL/Prisma database. It is available at:

- `/platform/clients`
- `/platform/billing`
- `/platform/activity`
- `/platform/security`

All platform API routes are protected by `SUPER_ADMIN` authorization and owner two-step verification:

```text
/api/admin/platform/*
/api/admin/billing/*
```

## Create the first platform owner

Run this once from the backend release directory. It refuses to overwrite an existing platform owner and prints a one-time password.

```bash
npm run admin:create-platform-owner -- owner@yourcompany.com
```

The account is created with `mustChangePassword=true`. Sign in at the alpha/prod frontend, change the password, then open `/platform/security` and enable authenticator-app 2FA. Owner routes remain blocked until 2FA is enabled.

## Deploy against the live database

Set the pooled URL as `DATABASE_URL` for API traffic and the direct URL as `DATABASE_URL_UNPOOLED` for Prisma migrations. Then run:

```bash
npm run db:deploy
npm run build
npm start
```

Do not run `db:push` against the live database. Keep the owner creation command as a one-time operational action and never commit the generated password.
