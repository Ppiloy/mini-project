import { WORKSHEET_LABELS, type WorksheetLetter } from "../../shared/labels.js";

export function FieldLabel({ letter }: { letter: WorksheetLetter }) {
  return <span className="worksheet-label">
    <span className="worksheet-label-name">{WORKSHEET_LABELS[letter]}</span>
    {" "}
    <small className="worksheet-label-code">({letter})</small>
  </span>;
}
