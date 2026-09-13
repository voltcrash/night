export type OutputView = "markdown" | "text" | "rich-text" | "html" | "pdf";

export interface OutputViewOption {
  id: OutputView;
  label: string;
  description: string;
  /** The file extension the view exports, shown as its tab. */
  format: string;
  /** Absent when the view has nothing to copy. */
  copyTitle?: string;
  downloadLabel: string;
  downloadTitle: string;
}

export const outputViews: OutputViewOption[] = [
  {
    id: "markdown",
    label: "Markdown",
    description: "Write and edit the Markdown source",
    format: "MD",
    copyTitle: "Copy this note as Markdown",
    downloadLabel: "Download",
    downloadTitle: "Download this note as a Markdown file",
  },
  {
    id: "text",
    label: "Plain text",
    description: "Read the note as plain text, then copy or download it",
    format: "TXT",
    copyTitle: "Copy this note as plain text",
    downloadLabel: "Download",
    downloadTitle: "Download this note as a text file",
  },
  {
    id: "rich-text",
    label: "Rich text",
    description: "Copy the formatted note into a document, or download it as RTF",
    format: "RTF",
    copyTitle: "Copy this note with its formatting, to paste into a document or email",
    downloadLabel: "Download",
    downloadTitle: "Download this note as an RTF document",
  },
  {
    id: "html",
    label: "HTML",
    description: "Read the generated HTML, then copy or download it",
    format: "HTML",
    copyTitle: "Copy this note as HTML",
    downloadLabel: "Download",
    downloadTitle: "Download this note as an HTML file",
  },
  {
    id: "pdf",
    label: "PDF",
    description: "Preview the printed page and save it as a PDF",
    format: "PDF",
    downloadLabel: "Save as PDF",
    downloadTitle: "Print this note, or save it as a PDF from the print dialog",
  },
];

export function isOutputView(value: string | undefined): value is OutputView {
  return outputViews.some((view) => view.id === value);
}
