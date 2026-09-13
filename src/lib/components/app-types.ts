export type BackupState = "idle" | "backing-up" | "success" | "error";
export type GithubState = "loading" | "connected" | "disconnected" | "error";
export type RestoreState = "idle" | "loading" | "restoring" | "error";
export type SaveState = "loading" | "saved" | "saving" | "unsaved" | "error";
export type TransferState = "idle" | "working" | "error";

// "columns" places the panes side by side; "rows" stacks them with a horizontal divider.
export type PaneLayout = "columns" | "rows";
export type PaneOrder = "source-first" | "rendered-first";
export type PaneEdge = "left" | "right" | "top" | "bottom";
