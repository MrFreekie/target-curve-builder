// Undo and redo history for the document, as JSON text. Pure: no DOM, no clock of its own (the caller passes the time).

/**
 * @param {{start: string, max?: number, coalesceMs?: number}} options `start` is the document as it is now.
 * Edits of the same control closer together than `coalesceMs` share one undo step; at most `max` steps are kept.
 */
export function createHistory({ start, max = 100, coalesceMs = 800 }) {
  const undoStack = [];
  const redoStack = [];
  let current = start;
  let lastKey = null;
  let lastAt = 0;
  return {
    /** The document text as of the last record, undo, redo or adopt. */
    current: () => current,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    /**
     * Note that the document is now `json`. Returns false (and does nothing) when it is unchanged.
     * @param {string} json
     * @param {string|object|null} key the control being edited, or null when edits shouldn't be merged
     * @param {number} now milliseconds
     */
    record(json, key, now) {
      if (json === current) return false;
      if (!(key && key === lastKey && now - lastAt < coalesceMs)) {
        undoStack.push(current);
        if (undoStack.length > max) undoStack.shift();
      }
      lastAt = now;
      lastKey = key;
      redoStack.length = 0;
      current = json;
      return true;
    },
    /** Step back: returns the earlier document text, or null if there is none. */
    undo() {
      if (!undoStack.length) return null;
      redoStack.push(current);
      current = undoStack.pop();
      lastKey = null;
      return current;
    },
    /** Step forward again: returns the text, or null if there is none. */
    redo() {
      if (!redoStack.length) return null;
      undoStack.push(current);
      current = redoStack.pop();
      lastKey = null;
      return current;
    },
    /** Take `json` as the current document without adding a step (for a recovery or a fresh start). */
    adopt(json) {
      current = json;
      lastKey = null;
    },
  };
}
