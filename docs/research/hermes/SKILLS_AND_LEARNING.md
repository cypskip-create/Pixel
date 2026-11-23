# Skills & Self-Improvement Architecture

Source authority: `tools/skill_manager_tool.py`, `tools/skill_manager_guards.py`, `tools/skills_guard.py`, `tools/skills_tool.py`, `agent/skill_utils.py`, `agent/background_review.py`, `optional-skills/` (819 files).

## 1. How Hermes Skills Work
- **Format:** Human-readable directory `<skills>/[category/]<skill>/SKILL.md` (YAML frontmatter `name`, `description`, optional `conditions`/platform/app filters + Markdown instructions) plus optional `references/`, `templates/`, `scripts/`, `assets/`.
- **Progressive Disclosure in Prompt:** `agent/prompt_builder.py` injects only a compact skills index (name + clipped description within `SKILL_PROMPT_DESC_LIMIT`); full `SKILL.md` content is loaded on demand via `skill_view`.
- **Agent-Managed Skill Editing (`skill_manage`):**
  - Supports `create`, `patch`, `write_file`, `remove_file`, `delete`, and atomic `batch` edits under per-skill SHA-256 lock files (`<skills>/.locks/<digest>.lock`).
  - **Self-Improvement Loop (`agent/background_review.py`):** A background-review fork with a narrowed tool whitelist (`memory` + `skills` only — no `terminal`) can review completed sessions and propose or update skills.
  - **Safeguards:**
    - Post-write security scanning (`tools/skills_guard.py::scan_skill` + `should_allow_install`): **always enforced** for background-review writes (opt-in for foreground writes via `skills.guard_agent_created`).
    - Read-before-write guard (`_background_review_read_before_write_guard`) and delete guards (`_background_review_delete_guard`, `_pinned_guard`) prevent background reviews from blindly clobbering or deleting pinned user skills.
    - Baseline diffing (`_introduced_findings`) ensures edits are blocked only for newly introduced security hazards.

## 2. Comparison with Pixel's Current Skills & Routines
- **Pixel today (`src/main/skills/`):** Stores versioned, structured tool-plan skills in SQLite (`SkillStore`), recorded from verified completed tasks (`draftSkillFromTask`) with explicit draft → user review → activation lifecycle and deterministic ordered tool replay (`buildSkillToolPlan`).
- **Gap & Recommended Synthesis:**
  - Preserve Pixel's **reviewed deterministic tool-plan skills** for safety-critical repeatable automations and scheduled routines.
  - Add a **Procedural Knowledge Skill (`SKILL.md`) layer** (progressive-disclosure Markdown playbooks in `<userData>/skills/`) that Pixel can draft after complex solved tasks, scan with a static threat/secret check, and require explicit user approval before activation — never silently mutating core Pixel code or active skills without review.
