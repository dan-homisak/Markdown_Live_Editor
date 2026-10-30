/** Track host document snapshots, including host-coalesced Undo/Redo events.
 * Availability is per document and survives switching between live tabs. */
export class HistoryAvailability {
  private states: string[];
  private index = 0;
  constructor(text: string) { this.states = [text]; }
  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.states.length - 1; }
  update(text: string, reason?: "undo" | "redo"): void {
    if (text === this.states[this.index]) return;
    if (reason === "undo") {
      for (let index = this.index - 1; index >= 0; index--) {
        if (this.states[index] === text) { this.index = index; return; }
      }
      // History may predate opening this editor. Its newly observed base can
      // be redone, but no further older steps have yet been observed.
      this.states.unshift(text); this.index = 0;
    } else if (reason === "redo") {
      const index = this.states.indexOf(text, this.index + 1);
      if (index >= 0) this.index = index;
      else { this.states = this.states.slice(0, this.index + 1); this.states.push(text); this.index++; }
    } else {
      this.states = this.states.slice(0, this.index + 1);
      this.states.push(text); this.index++;
    }
    if (this.states.length > 201) {
      const excess = Math.min(this.index, this.states.length - 201);
      this.states.splice(0, excess); this.index -= excess;
      this.states.length = Math.min(this.states.length, 201);
    }
  }
}
