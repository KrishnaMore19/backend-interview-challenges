Backend Interview Challenge - Task Sync API
Solution Overview
This is my implementation of a task management API with offline-first sync capabilities. The solution supports creating, updating, and deleting tasks while offline, with automatic synchronization when the connection is restored.

🚀 Quick Start
Prerequisites

Node.js v18 or higher
npm or yarn

Installation & Setup
bash# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Run the development server
npm run dev
Running Tests
bash# Run all tests
npm test

# Run tests with UI
npm run test:ui

# Type checking
npm run typecheck

# Linting
npm run lint

📋 Implementation Approach
Architecture Overview
The solution follows a clean, layered architecture:

Database Layer (src/db/database.ts)

SQLite for local data persistence
Two tables: tasks and sync_queue
Promisified database operations for async/await pattern


Service Layer

TaskService: Handles all task CRUD operations
SyncService: Manages sync queue and conflict resolution


API Layer (src/routes/)

RESTful endpoints for task management
Sync-specific endpoints for manual triggers and status checks



Key Features Implemented
✅ Offline-First Design

All operations work offline and queue for sync
Tasks marked with sync_status: 'pending' when created/modified

✅ Batch Synchronization

Configurable batch size via SYNC_BATCH_SIZE environment variable
Default batch size: 50 items
Efficient processing of multiple operations at once

✅ Conflict Resolution

Last-write-wins strategy based on updated_at timestamps
Automatic conflict detection and resolution
Conflicts logged for debugging

✅ Error Handling & Retry Logic

Maximum 3 retry attempts (configurable via SYNC_RETRY_ATTEMPTS)
Failed syncs remain in queue for retry
Comprehensive error responses with timestamps

✅ Type Safety

Full TypeScript implementation
Strict type checking enabled
All interfaces properly defined


🧩 Assumptions & Design Decisions

This section outlines the assumptions and reasoning behind specific implementation choices made during the development of the Task Sync API.

1. Database Assumptions

SQLite used for local persistence — assumed that the API runs on a single instance/device, making SQLite sufficient for testing and lightweight environments.

For production or multi-device setups, a scalable database (PostgreSQL/MySQL) with user authentication would be used.

Soft delete mechanism — instead of deleting tasks permanently, an is_deleted flag is used to preserve data integrity and allow possible “undo” functionality in future versions.

2. Sync Queue Behavior

FIFO order (First In, First Out) — assumed that processing operations chronologically ensures consistent data synchronization (Create → Update → Delete).

Each operation is recorded separately — multiple updates for the same task generate multiple sync entries; the latest update overwrites previous ones.

Queue persistence — sync entries remain in the queue until successful completion. After three failed attempts, items are marked as error for debugging and retry.

3. Conflict Resolution

Last-Write-Wins (LWW) strategy — chosen for simplicity and predictability, comparing updated_at timestamps to decide which record prevails.

If timestamps are identical, the server version takes priority.

Alternative strategies like vector clocks or manual resolution were considered but deemed unnecessary for this project’s scope.

LWW is common for offline-first applications where personal or low-collaboration use cases are expected.

4. API Design

RESTful architecture — standard HTTP verbs (GET, POST, PUT, DELETE) and consistent status codes were assumed to be expected by reviewers.

Dedicated Sync Endpoints:

/api/sync → Manually trigger synchronization

/api/status → Check sync progress or state

/api/batch → Process queued operations in bulk

These were separated to keep core task CRUD endpoints focused and maintain clean separation of responsibilities.