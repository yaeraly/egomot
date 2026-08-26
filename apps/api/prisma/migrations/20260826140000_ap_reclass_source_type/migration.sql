-- Additive source type for moving mixed Supplier AP onto Cargo/Transport AP.
-- Does not rewrite historical journals or change inventory capitalization.

ALTER TYPE "AccountingSourceType" ADD VALUE 'AP_RECLASS';
