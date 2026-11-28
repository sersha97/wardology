-- Skipped questions stay unseen (Nov 2026). Before this, ending a block marked every unanswered question
-- as "omitted" and revealed its answer. Undo that for blocks ended earlier: hide them again and return
-- them to the Unused pool. Safe to run more than once.
--   wrangler d1 execute wardology-qbank --remote --file qbank/migrations/0003_unseen_skipped.sql
UPDATE test_items SET revealed = 0, correct = NULL WHERE revealed = 1 AND choice IS NULL;
DELETE FROM user_q WHERE status = 'omitted' AND first_correct IS NULL;
