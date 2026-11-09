-- A morning reminder to the supervisor about a count missing from the last working day.
ALTER TYPE "NotificationKind" ADD VALUE 'MISSED_YESTERDAY';

-- The work day the phone was on when a count was typed, so a late entry can be shown as late.
ALTER TABLE "DailyUpdate" ADD COLUMN "enteredOn" DATE;
