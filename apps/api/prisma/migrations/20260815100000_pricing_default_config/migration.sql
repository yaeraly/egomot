-- Default 90-day customer category thresholds
INSERT INTO "ClientCategoryThreshold" ("id", "category", "minPaidAmountKgs", "maxPaidAmountKgs", "priority", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'STANDARD', 0, 49999.99, 1, true, NOW(), NOW()),
  (gen_random_uuid(), 'SILVER', 50000, 149999.99, 2, true, NOW(), NOW()),
  (gen_random_uuid(), 'GOLD', 150000, 299999.99, 3, true, NOW(), NOW()),
  (gen_random_uuid(), 'VIP', 300000, NULL, 4, true, NOW(), NOW())
ON CONFLICT ("category") DO UPDATE SET
  "minPaidAmountKgs" = EXCLUDED."minPaidAmountKgs",
  "maxPaidAmountKgs" = EXCLUDED."maxPaidAmountKgs",
  "priority" = EXCLUDED."priority",
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = NOW();

-- Default Client Type × Category markup matrix (%)
INSERT INTO "ClientTypeCategoryMarkup" ("id", "clientType", "category", "markupPercent", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'RETAIL', 'STANDARD', 15, NOW(), NOW()),
  (gen_random_uuid(), 'RETAIL', 'SILVER', 12, NOW(), NOW()),
  (gen_random_uuid(), 'RETAIL', 'GOLD', 10, NOW(), NOW()),
  (gen_random_uuid(), 'RETAIL', 'VIP', 8, NOW(), NOW()),
  (gen_random_uuid(), 'MASTER', 'STANDARD', 8, NOW(), NOW()),
  (gen_random_uuid(), 'MASTER', 'SILVER', 5, NOW(), NOW()),
  (gen_random_uuid(), 'MASTER', 'GOLD', 3, NOW(), NOW()),
  (gen_random_uuid(), 'MASTER', 'VIP', 1, NOW(), NOW()),
  (gen_random_uuid(), 'WHOLESALE', 'STANDARD', 5, NOW(), NOW()),
  (gen_random_uuid(), 'WHOLESALE', 'SILVER', 3, NOW(), NOW()),
  (gen_random_uuid(), 'WHOLESALE', 'GOLD', 1, NOW(), NOW()),
  (gen_random_uuid(), 'WHOLESALE', 'VIP', 0, NOW(), NOW())
ON CONFLICT ("clientType", "category") DO UPDATE SET
  "markupPercent" = EXCLUDED."markupPercent",
  "updatedAt" = NOW();
