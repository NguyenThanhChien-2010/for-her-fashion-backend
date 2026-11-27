-- Expand inventory adjustment reason to match OpenAPI.
ALTER TABLE `inventory_adjustments`
    MODIFY COLUMN `reason` VARCHAR(2000) NOT NULL;
