# Class Schedule Module Documentation

> A comprehensive class scheduling system for gym management, allowing administrators to create recurring class schedules tied to gym class templates and trainers.

---

## Quick Start

```bash
# List all class schedules
GET /class-schedule/list

# Create a new schedule (Admin only)
POST /class-schedule/create
{
  "classId": "uuid-of-gym-class",
  "trainerId": "uuid-of-trainer",
  "dayOfWeek": "MON",
  "startTime": "2025-01-01T09:00:00Z",
  "endTime": "2025-01-01T10:00:00Z",
  "location": "Studio A",
  "capacity": 20
}
```

---

## Schema Overview

### Database Models

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│    GymClass     │       │  ClassSchedule  │       │      User       │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id              │◄──────│ classId         │       │ id              │
│ className       │       │ trainerId       │──────►│ firstName       │
│ description     │       │ dayOfWeek       │       │ lastName        │
│ difficultyLevel │       │ startTime       │       │ email           │
│ category        │       │ endTime         │       └─────────────────┘
│ isActive        │       │ validFrom       │
└─────────────────┘       │ validUntil      │
                          │ location        │
                          │ capacity        │
                          │ isActive        │
                          └─────────────────┘
```

### Key Fields

| Field        | Type    | Description                       |
| ------------ | ------- | --------------------------------- |
| `classId`    | UUID    | Links to GymClass template        |
| `trainerId`  | UUID    | **Required** - Assigned trainer   |
| `dayOfWeek`  | Enum    | MON, TUE, WED, THU, FRI, SAT, SUN |
| `startTime`  | Time    | Class start time                  |
| `endTime`    | Time    | Class end time                    |
| `validFrom`  | Date    | Schedule active from (nullable)   |
| `validUntil` | Date    | Schedule active until (nullable)  |
| `location`   | String  | Room/studio location              |
| `capacity`   | Int     | Max attendees (default: 20)       |
| `isActive`   | Boolean | Active flag (default: true)       |

---

## API Endpoints

### `POST /class-schedule/create`

**Role:** Admin only

Create a new class schedule.

```json
// Request
{
  "classId": "123e4567-e89b-12d3-a456-426614174000",
  "trainerId": "123e4567-e89b-12d3-a456-426614174001",
  "dayOfWeek": "MON",
  "startTime": "2025-01-01T09:00:00Z",
  "endTime": "2025-01-01T10:00:00Z",
  "validFrom": "2025-01-01",
  "validUntil": "2025-12-31",
  "location": "Studio A",
  "capacity": 20,
  "isActive": true
}

// Response (201)
{
  "data": {
    "id": "generated-uuid",
    "className": "Morning Yoga",
    "dayOfWeek": "MON",
    "startTime": "09:00:00",
    "endTime": "10:00:00",
    "location": "Studio A",
    "capacity": 20,
    "trainerName": "John Trainer",
    ...
  }
}
```

---

### `GET /class-schedule/list`

**Role:** All authenticated users

Get paginated list of class schedules with filtering.

**Query Parameters:**

| Param         | Type    | Description                  |
| ------------- | ------- | ---------------------------- |
| `page`        | string  | Page number (default: 1)     |
| `limit`       | string  | Items per page (default: 10) |
| `sort`        | enum    | `asc` or `desc`              |
| `sortBy`      | string  | Field to sort by             |
| `q`           | string  | Search query                 |
| `searchField` | string  | Specific field to search     |
| `dayOfWeek`   | enum    | Filter by day (MON-SUN)      |
| `trainerId`   | UUID    | Filter by trainer            |
| `classId`     | UUID    | Filter by gym class          |
| `isActive`    | boolean | Filter by active status      |

```bash
# Example: Get Monday classes
GET /class-schedule/list?dayOfWeek=MON&isActive=true
```

---

### `GET /class-schedule/:id`

**Role:** Admin only

Get single schedule by ID.

---

### `PATCH /class-schedule/:id`

**Role:** Admin only

Update schedule properties.

---

### `DELETE /class-schedule/:id`

**Role:** Admin only

Delete a class schedule.

---

### `POST /class-schedule/check-conflict`

**Role:** Admin, Staff

Check if a proposed schedule conflicts with existing trainer schedules. Useful for frontend validation before creating/updating schedules.

```json
// Request
{
  "trainerId": "123e4567-e89b-12d3-a456-426614174000",
  "dayOfWeek": "MON",
  "startTime": "2025-01-01T09:00:00Z",
  "endTime": "2025-01-01T10:00:00Z",
  "excludeScheduleId": "optional-schedule-id-for-updates"
}

// Response (200)
{
  "data": {
    "hasConflict": true,
    "conflictingSchedules": [
      {
        "id": "uuid",
        "className": "Morning Yoga",
        "dayOfWeek": "MON",
        "startTime": "08:30:00",
        "endTime": "09:30:00",
        "location": "Studio A"
      }
    ]
  }
}
```

---

## Features Implementation Checklist

### ✅ Implemented

- [x] **CRUD Operations**
  - [x] Create schedule with GymClass and Trainer
  - [x] Read single schedule by ID
  - [x] Update schedule properties
  - [x] Delete schedule
  - [x] List schedules with pagination

- [x] **Filtering & Search**
  - [x] Search by location
  - [x] Search by class name
  - [x] Filter by day of week
  - [x] Filter by trainer ID
  - [x] Filter by gym class ID
  - [x] Filter by active status

- [x] **Schedule Properties**
  - [x] Day of week (recurring pattern)
  - [x] Start/end time
  - [x] Validity period (validFrom/validUntil)
  - [x] Location
  - [x] Capacity limit
  - [x] Active/inactive toggle

- [x] **Relations**
  - [x] Link to GymClass template
  - [x] Link to Trainer (required)
  - [x] One-to-many with ClassBooking

- [x] **Helper Methods**
  - [x] `findByDayOfWeek()` - Weekly schedule views
  - [x] `findByTrainerId()` - Trainer dashboards
  - [x] `checkConflict()` - Conflict detection

- [x] **Swagger Documentation**
  - [x] All query parameters documented
  - [x] Request/response examples

- [x] **Schedule Validation** ✨ NEW
  - [x] Prevent overlapping schedules for same trainer
  - [x] Time slot conflict detection on create/update
  - [x] `POST /check-conflict` endpoint for frontend validation
  - [x] Booking validates day-of-week matches schedule

---

### ⏳ Not Yet Implemented

- [ ] **Remaining Slots Tracking**
  - [ ] Real-time available spots counter
  - [ ] Response includes `remainingSlots` field

- [ ] **GymClass Module**
  - [ ] Separate CRUD for class templates
  - [ ] Endpoints for managing class definitions

- [ ] **Recurring Patterns**
  - [ ] Multiple days per schedule (ScheduleDay junction table)
  - [ ] Exception dates handling (ScheduleException model)

- [ ] **Notifications**
  - [ ] Class cancellation notifications
  - [ ] Schedule change alerts

---

## File Structure

```
src/modules/class-schedule/
├── class-schedule.controller.ts    # API endpoints (6 endpoints)
├── class-schedule.service.ts       # Business logic
├── class-schedule.module.ts        # Module definition
├── dto/
│   ├── create-class-schedule.dto.ts  # Create DTO
│   ├── update-class-schedule.dto.ts  # Update DTO (PartialType)
│   ├── class-schedule-query.dto.ts   # Query parameters
│   └── check-conflict.dto.ts         # Conflict check DTO ✨ NEW
├── entities/
│   ├── class-schedule.entity.ts    # ClassScheduleEntity
│   └── gym-class.entity.ts         # GymClassEntity
├── mapper/
│   └── class-schedule.mapper.ts    # Prisma ↔ Entity mapping
└── repositories/
    └── class-schedule.repository.ts # Database operations (incl. conflict check)
```

---

## Related Modules

| Module                  | Relationship                               |
| ----------------------- | ------------------------------------------ |
| **GymClass**            | ClassSchedule references GymClass template |
| **User (Trainer)**      | Each schedule has a required trainer       |
| **ClassBooking**        | Members book into schedules                |
| **TrainerAvailability** | Validates trainer is available             |

---

## Database Indexes

```prisma
@@index([classId])
@@index([trainerId])
@@index([dayOfWeek, startTime])
@@index([dayOfWeek, isActive, capacity])
```

---

> **Last Updated:** January 2026
