# Database Integrity Management

## Overview

The SQLite database adapter now includes built-in integrity checking and recovery mechanisms to handle database corruption gracefully.

## Features

### 1. Integrity Checking

The `checkIntegrity()` function performs health checks on the database:

```typescript
import { checkIntegrity } from './adapters/db';

// Quick check (default) - faster, checks basic structure
const quickResult = await checkIntegrity();
if (!quickResult.isHealthy) {
  console.error('Database corruption detected:', quickResult.errors);
}

// Full check - more thorough, checks constraints
const fullResult = await checkIntegrity(true);
```

**When to use:**
- Quick check: During startup, before critical operations
- Full check: After recovering from errors, during maintenance

### 2. Database Backup

The `createDbBackup()` function creates a backup of the database:

```typescript
import { createDbBackup } from './adapters/db';

try {
  const backupPath = await createDbBackup();
  console.log('Backup created:', backupPath);
} catch (error) {
  console.error('Backup failed:', error);
}
```

**Features:**
- Uses SQLite's `VACUUM INTO` command
- Creates timestamped backups
- Rebuilds database structure (can fix minor corruption)

### 3. Enhanced Error Handling

The `emails.delete()` method now automatically detects corruption:

```typescript
try {
  await emailRepo.delete(emailId);
} catch (error) {
  if (error.message.includes('Database corruption detected')) {
    // Handle corruption - backup and recreate database
    const backupPath = await createDbBackup();
    // Notify user to restart application
  }
}
```

## Root Causes of "Disk Image Malformed" Errors

Based on our analysis, the most common causes are:

1. **WAL Mode Concurrent Access**
   - Multiple processes accessing the database simultaneously
   - Solution: Ensure single process access or use proper locking

2. **FTS Trigger Failures**
   - Full-text search triggers failing during CASCADE deletes
   - Solution: Enhanced error handling (already implemented)

3. **Incomplete Transactions**
   - Power loss or crash during write operations
   - Solution: Regular integrity checks and backups

4. **Disk I/O Errors**
   - Hardware-level storage issues
   - Solution: Detect early via integrity checks, backup data

## Recovery Strategy

When corruption is detected:

1. **Create a backup immediately:**
   ```typescript
   const backupPath = await createDbBackup();
   ```

2. **Run integrity check to assess damage:**
   ```typescript
   const result = await checkIntegrity(true);
   console.log('Corruption details:', result.errors);
   ```

3. **Options for recovery:**
   - If backup succeeds: Restore from backup
   - If backup fails: Database may be severely corrupted
     - Export data manually
     - Recreate database from schema
     - Re-sync from IMAP server

## Best Practices

1. **Periodic Integrity Checks**
   - Run quick checks on application startup
   - Run full checks weekly or after errors

2. **Automatic Backups**
   - Before major operations (bulk delete, sync)
   - After successful integrity checks
   - Keep 3-5 recent backups

3. **Error Monitoring**
   - Log all corruption events
   - Track patterns (specific operations, timing)
   - Monitor for recurring issues

4. **Database Maintenance**
   - Regular VACUUM operations (monthly)
   - Monitor database file size
   - Check WAL file growth

## Implementation Details

### Integrity Check Internals

- **Quick Check:** Uses `PRAGMA quick_check`
  - Faster, checks basic structure
  - Doesn't verify UNIQUE constraints
  - Recommended for frequent checks

- **Full Check:** Uses `PRAGMA integrity_check`
  - Comprehensive validation
  - Checks all constraints
  - Slower, for thorough analysis

### Backup Internals

- Uses `VACUUM INTO` command
- Creates a compacted copy of the database
- Rebuilds internal structures
- Can fix some types of corruption automatically

### Transaction Safety

All delete operations use transactions to ensure:
- Atomicity with CASCADE deletes
- FTS trigger consistency
- Proper rollback on errors

## Testing

Run the test suite to verify integrity checking:

```bash
npm test -- src/adapters/db/index.test.ts
```

Tests cover:
- Healthy database checks
- Corruption detection
- Backup creation
- Error handling in delete operations
