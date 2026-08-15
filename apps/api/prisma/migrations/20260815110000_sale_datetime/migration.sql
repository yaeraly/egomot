-- Store sale date with time for historical accuracy
ALTER TABLE "Sale" ALTER COLUMN "saleDate" TYPE TIMESTAMP(3) USING "saleDate"::timestamp;
