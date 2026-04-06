export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

export function isValidDurationMinutes(durationMinutes: number): boolean {
  return [30, 60, 90].includes(durationMinutes);
}

export function minutesBetween(startAt: Date, endAt: Date): number {
  return Math.round((endAt.getTime() - startAt.getTime()) / 60000);
}

export function overlaps(left: TimeRange, right: TimeRange): boolean {
  return left.startAt < right.endAt && left.endAt > right.startAt;
}

export function mergeTimeRanges(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length <= 1) {
    return [...ranges];
  }

  const sorted = [...ranges].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );

  const merged: TimeRange[] = [{ ...sorted[0] }];
  for (const range of sorted.slice(1)) {
    const current = merged[merged.length - 1];

    if (range.startAt <= current.endAt) {
      current.endAt = new Date(
        Math.max(current.endAt.getTime(), range.endAt.getTime()),
      );
      continue;
    }

    merged.push({ startAt: new Date(range.startAt), endAt: new Date(range.endAt) });
  }

  return merged;
}

export function subtractTimeRanges(
  baseRanges: TimeRange[],
  blockedRanges: TimeRange[],
): TimeRange[] {
  const mergedBlocks = mergeTimeRanges(blockedRanges);
  const result: TimeRange[] = [];

  for (const base of baseRanges) {
    let cursor = base.startAt.getTime();

    for (const block of mergedBlocks) {
      const blockStart = block.startAt.getTime();
      const blockEnd = block.endAt.getTime();

      if (blockEnd <= cursor || blockStart >= base.endAt.getTime()) {
        continue;
      }

      if (blockStart > cursor) {
        result.push({
          startAt: new Date(cursor),
          endAt: new Date(Math.min(blockStart, base.endAt.getTime())),
        });
      }

      cursor = Math.max(cursor, blockEnd);

      if (cursor >= base.endAt.getTime()) {
        break;
      }
    }

    if (cursor < base.endAt.getTime()) {
      result.push({ startAt: new Date(cursor), endAt: new Date(base.endAt) });
    }
  }

  return result.filter((range) => range.endAt > range.startAt);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

export function createUtcDate(date: Date, timeSource: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      timeSource.getUTCHours(),
      timeSource.getUTCMinutes(),
      timeSource.getUTCSeconds(),
      timeSource.getUTCMilliseconds(),
    ),
  );
}

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function endOfUtcDay(date: Date): Date {
  return addMinutes(startOfUtcDay(date), 24 * 60);
}

export function dayOfWeekToIndex(date: Date): number {
  return date.getUTCDay();
}

export function sameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

