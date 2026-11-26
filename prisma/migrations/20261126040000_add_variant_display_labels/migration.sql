-- BE-02 M02: Variant display labels
-- Keep SKU, colorId and sizeCode unchanged.

ALTER TABLE `product_variants`
    ADD COLUMN `colorDisplayLabel` VARCHAR(100) NULL,
    ADD COLUMN `sizeDisplayLabel` VARCHAR(100) NULL;