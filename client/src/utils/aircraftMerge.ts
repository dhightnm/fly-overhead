/**
 * Centralized aircraft merge utility
 * Handles intelligent merging of aircraft records with priority-based logic
 */
import type { Aircraft } from '../types';

/**
 * Get priority score for aircraft source (higher = more authoritative)
 */
export const getSourcePriority = (source?: string | null): number => {
  switch ((source || '').toLowerCase()) {
    case 'manual':
      return 100;
    case 'live':
      return 80;
    case 'websocket':
      return 60;
    case 'database':
      return 40;
    default:
      return 20;
  }
};

/**
 * Merge two aircraft records intelligently
 * Priority order:
 * 1. Source priority (manual > live > websocket > database)
 * 2. Predicted status (predicted records get -50 priority penalty)
 * 3. Timestamp (newer wins if same priority)
 * 
 * @param existing - Existing aircraft record (may be undefined)
 * @param incoming - New aircraft record to merge
 * @returns Merged aircraft record
 */
export const mergePlaneRecords = (
  existing: Aircraft | undefined,
  incoming: Aircraft
): Aircraft => {
  if (!existing) {
    return incoming;
  }

  const existingTimestamp = existing.last_contact ?? 0;
  const incomingTimestamp = incoming.last_contact ?? 0;
  const existingPriority = getSourcePriority(existing.source);
  const incomingPriority = getSourcePriority(incoming.source);
  const existingPredicted = existing.predicted === true;
  const incomingPredicted = incoming.predicted === true;

  // Adjust priority: predicted records get -50 penalty
  const adjustedExistingPriority = existingPriority - (existingPredicted ? 50 : 0);
  const adjustedIncomingPriority = incomingPriority - (incomingPredicted ? 50 : 0);

  /**
   * Combine two records, preferring the higher-priority one
   */
  const combineRecords = (preferred: Aircraft, secondary: Aircraft): Aircraft => {
    const merged = {
      ...secondary,
      ...preferred,
    };
    merged.category = preferred.category ?? secondary.category ?? null;
    merged.source = preferred.source ?? secondary.source;
    merged.predicted = preferred.predicted ?? secondary.predicted ?? false;
    merged.prediction_confidence = preferred.prediction_confidence ?? secondary.prediction_confidence;
    return merged;
  };

  // Compare adjusted priorities
  if (adjustedExistingPriority > adjustedIncomingPriority) {
    return combineRecords(existing, incoming);
  }

  if (adjustedIncomingPriority > adjustedExistingPriority) {
    return combineRecords(incoming, existing);
  }

  // Same priority - compare timestamps
  // Use < instead of <= to allow same-timestamp updates (for map movement refreshes)
  if (incomingTimestamp < existingTimestamp) {
    return combineRecords(existing, incoming);
  }

  // Incoming is newer or same timestamp - prefer incoming (allows position updates on map move)
  return combineRecords(incoming, existing);
};

