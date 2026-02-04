# Lessons Learned

## Session 2026-02-04: Multi-User Implementation

### Lesson 1: Always Write Test Plans for Post-Implementation Tasks

**What happened**: Implemented full multi-user feature (wallet linking, account setup, trading) but didn't write a test plan until prompted by user.

**Why it matters**:
- Test plans ensure nothing is missed during verification
- Provides clear checklist for manual QA
- Documents expected behavior for future maintainers
- Catches edge cases that unit tests might miss

**Rule**: After implementing any non-trivial feature, **always** create `tasks/<feature>-test-plan.md` before marking the task complete.

**Example test plan sections**:
1. Prerequisites (environment setup)
2. Test matrix (all test cases with IDs)
3. Detailed test cases with steps and expected output
4. Verification checklist
5. Sign-off section

---

### Lesson 2: SQLite datetime() Comparisons

**What happened**: `cleanupExpiredRequests()` used `datetime(?)` wrapper which didn't work correctly with ISO timestamps.

**Fix**: Use direct string comparison since ISO 8601 timestamps are lexicographically sortable:
```sql
-- Wrong
DELETE FROM link_requests WHERE expires_at < datetime(?)

-- Correct
DELETE FROM link_requests WHERE expires_at < ?
```

---

### Lesson 3: Test Database Isolation

**What happened**: Database tests failed with UNIQUE constraint errors because tests weren't properly isolated.

**Fix**: Use `beforeEach` to clear tables rather than recreating the database:
```typescript
beforeEach(() => {
  const db = getDatabase();
  db.exec("DELETE FROM users");
  db.exec("DELETE FROM link_requests");
});
```

This is faster and more reliable than closing/reopening the database.
