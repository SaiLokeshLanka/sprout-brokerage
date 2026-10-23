-- Reference data for trading.
-- 1) The shared exchange account: the counterparty for every buy and sell.
INSERT INTO "ledger_accounts" ("id", "type", "userId", "balancePaise", "createdAt", "updatedAt")
VALUES ('system-exchange', 'SYSTEM_EXCHANGE', NULL, 0, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 2) A blocked-funds account for every existing user (new users get one at sign-up).
INSERT INTO "ledger_accounts" ("id", "type", "userId", "balancePaise", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'USER_BLOCKED', u."id", 0, NOW(), NOW()
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "ledger_accounts" a WHERE a."userId" = u."id" AND a."type" = 'USER_BLOCKED'
);