-- linkedin-mena and indeed-mena were added as separate source families in 024_split_mena_families.sql.
-- They are now superseded: linkedin and indeed are unified sources with a `location` fan-out filter
-- (remote + GCC countries) added in feat/unified-location. Remove any lingering rows.
DELETE FROM sources WHERE name IN ('indeed-mena', 'linkedin-mena');
