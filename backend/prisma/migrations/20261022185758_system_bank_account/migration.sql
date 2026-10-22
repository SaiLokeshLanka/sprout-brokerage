-- Reference data: the single 'outside world' ledger account that every
-- deposit, withdrawal and welcome bonus is balanced against.
INSERT INTO "ledger_accounts" ("id", "type", "userId", "balancePaise", "createdAt", "updatedAt")
VALUES ('system-bank', 'SYSTEM_BANK', NULL, 0, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
