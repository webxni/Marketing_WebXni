-- Migration 0011: add last_login to users table
ALTER TABLE users ADD COLUMN last_login INTEGER;
