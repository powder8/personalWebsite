-- Google sign-in is identity-only; the app never calls Google APIs. Drop the
-- provider tokens Auth.js stored at sign-in (new sign-ins no longer store them).
UPDATE "accounts" SET "access_token" = NULL, "refresh_token" = NULL, "id_token" = NULL, "expires_at" = NULL;
