# Pixel document assistance

## Reading, extraction and provenance

`DocumentIndex` walks only a user-selected directory, with limits on depth,
file count and file size. It refuses roots reached through symlinks or junctions,
skips linked entries and credential-like filenames, and extracts supported PDF,
Office, CSV/TSV, text, structured-text, HTML and source formats through the
Python worker. Extracted text is chunked and indexed in the active project;
search results retain the original path and chunk location. The agent receives
retrieved excerpts inside an untrusted-content frame. Index/search/list are
registered in the shared tool registry and execute through `ToolExecutors`.

`documents_list` returns project-scoped document IDs. `documents_search`
rechecks freshness for every matched document before returning cached FTS
excerpts; changed or unavailable sources are withheld and the tool advises
re-indexing the user-approved folder. `documents_read` accepts one of those IDs
and returns at most ten indexed passages per call with the
document title, path and passage locations. It checks that the original regular
file still matches the indexed size/mtime signature and refuses to return cached
text when the source has changed or disappeared. Reads remain project-isolated;
the system prompt asks Pixel to cite document title and passage location when
summarizing retrieved evidence. Freshness uses the indexer's size/mtime
signature with millisecond timestamp precision, catching ordinary same-size
edits within a second on filesystems that expose it. Since this metadata-only
check avoids rereading and hashing the whole file, rewriting a source while
restoring both size and mtime can evade detection.

The Workspace Library can open a source from its preview after an explicit
user click. The main process accepts only a document ID from the active project,
revalidates the source against the index signature and allows only the reviewed
document/text extension set; it excludes source-code files and macro-enabled
spreadsheets. A keyboard-accessible folder action menu also opens an indexed
folder in Explorer using its project-scoped folder ID. The main process resolves
that ID against indexed rows and rejects a missing or symlinked directory.
Source paths never cross the renderer IPC boundary. Both actions call Electron
`shell.openPath`; document open also rechecks source freshness afterward. Results
say Windows accepted the request; they do not claim to have observed an app or
visible window.

## Authoring and exports

Pixel uses the existing approved `file_write` tool for text document creation
and editing. It is limited to the user's home directory, does not create parent
directories, refuses replacement unless `overwrite: true` is part of the
approved call, rejects sensitive filenames and symlinks, caps content at 64,000
characters, and reads the result back before reporting success. Common text
formats include `.txt`, `.md`, `.csv`, `.tsv`, `.json`, `.xml`, `.yaml`, `.html`,
`.rst` and plain-text configuration/source files.

The tool now refuses known binary formats, including PDF and Word/Excel/PowerPoint
files. Pixel does not claim to generate those formats by writing UTF-8 bytes.
After authoring a text document, the user can request indexing of its containing
directory to include it in provenance-linked search. That indexing is a separate
approved action; file writing does not silently expand the index scope.

## Remaining limits

There is no dedicated rich-document editor, general Office/PDF authoring/export,
or automatic binding between a newly written file and a source-cited summary.
Those remain incomplete. Notes support local Markdown/text import and Markdown
export, and migration 11 links supported existing document files to notes; see
`PIXEL_PRODUCTIVITY.md` for that separate workflow.
