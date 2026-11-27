-- M02: Add optional size chart instructions
ALTER TABLE `size_charts`
ADD COLUMN `instructions` TEXT NULL;