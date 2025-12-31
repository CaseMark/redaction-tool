# Redaction Tool Skill

Agent skill for developing the redaction-tool application.

## Directory Structure

```
.skill/
├── SKILL.md                        # Core skill (always read first)
└── references/
    ├── pii-detection.md            # Regex patterns and AI prompts
    └── pdf-processing.md           # PDF extraction and generation
```

---

## File Descriptions

### SKILL.md
**Purpose**: Primary entry point for the skill

**Contains**:
- Application architecture overview
- Tech stack (Next.js 14, pdf.js, pdf-lib, Case.dev LLM)
- Core workflow (upload → extract → detect → review → export)
- Two-pass detection explanation
- Redaction presets
- API endpoint reference

**When loaded**: Queries about redaction-tool, PII detection, document redaction

**Size**: ~140 lines

---

### references/pii-detection.md
**Purpose**: PII detection patterns and AI configuration

**Contains**:
- Two-pass detection architecture diagram
- Complete regex patterns for all PII types (SSN, credit card, phone, email, etc.)
- Luhn validation for credit cards
- AI/LLM detection prompt
- Confidence thresholds by type
- Masking functions
- Result merging logic
- Exclusion patterns for false positives
- Tuning guidance

**When to read**: Adding PII types, improving detection accuracy, debugging false positives

**Size**: ~250 lines

---

### references/pdf-processing.md
**Purpose**: PDF text extraction and generation

**Contains**:
- pdf.js setup and text extraction
- TextItem position mapping
- OCR fallback for scanned PDFs
- pdf-lib redacted PDF generation
- Black box overlay with labels
- Text-to-PDF generation with redactions applied
- Entity position mapping
- Audit log generation
- PDF download helper

**When to read**: PDF extraction issues, building export features, audit logging

**Size**: ~220 lines

---

## Progressive Disclosure

| Level | What Loads | Token Cost |
|-------|------------|------------|
| 1 | Frontmatter (name + description) | ~60 tokens |
| 2 | SKILL.md body | ~850 tokens |
| 3 | Reference files (as needed) | ~600-650 tokens each |

---

## Installation

```bash
cd redaction-tool
mkdir -p .skill/references
# Copy files into place
git add .skill/
git commit -m "Add agent skill for redaction-tool development"
```

---

## Trigger Examples

| Query | Loads |
|-------|-------|
| "Fix the file upload dropzone" | SKILL.md only |
| "Add detection for passport numbers" | SKILL.md + pii-detection.md |
| "Too many false positives on phone numbers" | SKILL.md + pii-detection.md |
| "PDF export is missing some redactions" | SKILL.md + pdf-processing.md |
| "Add audit log to exported PDF" | SKILL.md + pdf-processing.md |
