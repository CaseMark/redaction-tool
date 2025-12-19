# Smart Redaction Tool

An intelligent document redaction application that automatically detects and redacts Personally Identifiable Information (PII) from documents using a two-pass detection system combining regex pattern matching and AI-powered semantic analysis.

## Features

- **Two-Pass PII Detection**
  - **Pass 1: Regex Pattern Matching** - Fast, high-precision detection of standard formats (SSNs, credit cards, phone numbers, emails, etc.)
  - **Pass 2: AI/LLM Analysis** - Aggressive semantic detection using Case.dev's LLM to find non-standard formats, contextual PII, names, and addresses

- **Supported PII Types**
  - Social Security Numbers (SSN)
  - Bank Account Numbers
  - Credit Card Numbers
  - Names
  - Addresses
  - Phone Numbers
  - Email Addresses
  - Dates of Birth

- **Document Processing**
  - PDF text extraction using pdf.js
  - Text file support
  - Image OCR support (via Case.dev OCR API)

- **User-Friendly Workflow**
  1. **Upload** - Drag and drop or select documents
  2. **Configure** - Choose from prefigured redaction presets or custom selection
  3. **Review** - Preview detected entities, toggle individual redactions, edit masked values
  4. **Export** - Download redacted PDFs and audit logs

## Architecture

```
src/
├── app/
│   ├── page.tsx                    # Main application UI
│   └── api/
│       ├── detect-pii/route.ts     # Two-pass PII detection endpoint
│       ├── export-pdf/route.ts     # PDF generation with redactions
│       ├── detect/route.ts         # Database-backed detection (full workflow)
│       ├── export/route.ts         # Database-backed export
│       ├── jobs/route.ts           # Job management
│       └── upload/route.ts         # File upload handling
├── components/
│   ├── redaction/
│   │   ├── PatternSelector.tsx     # Redaction type selection UI
│   │   ├── EntityList.tsx          # Detected entities list with controls
│   │   └── DocumentPreview.tsx     # Document preview with highlights
│   ├── upload/
│   │   └── DropZone.tsx            # File upload component
│   └── ui/                         # Shadcn UI components
├── lib/
│   ├── redaction/
│   │   ├── detector.ts             # Two-pass detection logic
│   │   └── patterns.ts             # Regex patterns and presets
│   ├── case-dev/
│   │   └── client.ts               # Case.dev API client
│   ├── db.ts                       # Database connection
│   └── utils.ts                    # Utility functions
└── prisma/
    └── schema.prisma               # Database schema
```

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **UI Components**: Shadcn UI
- **PDF Processing**: pdf.js (extraction), pdf-lib (generation)
- **AI/LLM**: Case.dev API (GPT-4o)
- **Database**: PostgreSQL with Prisma ORM (optional, for full workflow)

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Case.dev API key (for AI-powered detection)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd redaction-tool
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your Case.dev API key:
   ```env
   CASEDEV_API_KEY=your_api_key_here
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open the application**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

### Database Setup (Optional)

For the full workflow with job persistence:

1. **Set up PostgreSQL** and add the connection string to `.env`:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/redaction_tool"
   ```

2. **Run migrations**:
   ```bash
   npx prisma migrate dev
   ```

## Usage

### Quick Start

1. **Upload Documents**: Drag and drop PDF or text files into the upload zone
2. **Select Redaction Types**: Choose a preset (e.g., "SSNs and Financial Account Numbers") or customize
3. **Scan Documents**: Click "Scan Documents" to run detection
4. **Review Results**: Toggle individual entities on/off, edit masked values if needed
5. **Export**: Generate and download the redacted PDF

### Redaction Presets

| Preset | Description | Types Included |
|--------|-------------|----------------|
| SSNs and Financial | Financial document redaction | SSN, Account Numbers, Credit Cards |
| All Personal Information | Comprehensive PII redaction | All types |
| Contact Information Only | Communication data | Phone, Email |
| Financial Only | Banking data | Account Numbers, Credit Cards |

### API Endpoints

#### POST `/api/detect-pii`
Detect PII in text using two-pass detection.

**Request:**
```json
{
  "text": "Document text content...",
  "types": ["SSN", "CREDIT_CARD", "NAME"]
}
```

**Response:**
```json
{
  "success": true,
  "count": 5,
  "matches": [
    {
      "id": "entity-123",
      "type": "SSN",
      "value": "123-45-6789",
      "maskedValue": "***-**-6789",
      "confidence": 0.95,
      "detectionMethod": "regex"
    }
  ]
}
```

#### POST `/api/export-pdf`
Generate a redacted PDF from text and entities.

**Request:**
```json
{
  "text": "Document text content...",
  "entities": [...],
  "filename": "redacted-document.pdf"
}
```

**Response:** PDF file download

## Detection Methodology

### Pass 1: Regex Pattern Matching
High-precision patterns for standard formats:
- SSN: `XXX-XX-XXXX` format with validation
- Credit Cards: Luhn-valid card number patterns
- Phone: US phone number formats
- Email: Standard email format
- Dates: Common date formats

### Pass 2: AI/LLM Analysis
Aggressive semantic detection for:
- Non-standard formats (e.g., "SSN: one two three...")
- Contextual references (e.g., "my social security number is...")
- Names and addresses (cannot be reliably detected with regex)
- OCR errors and typos
- Obfuscated or partial data

The AI is configured to be **moderately aggressive** - it's better to flag potential PII (which users can unselect) than to miss actual sensitive data.

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `CASEDEV_API_KEY` | Case.dev API key for LLM access | Yes |
| `DATABASE_URL` | PostgreSQL connection string | No (for full workflow) |

### Customizing Detection

Edit `src/lib/redaction/patterns.ts` to:
- Add new regex patterns
- Modify confidence thresholds
- Create new redaction presets

Edit `src/lib/redaction/detector.ts` to:
- Adjust LLM prompts
- Modify detection aggressiveness
- Add new detection passes

## License

MIT

## Support

For issues or questions, please open a GitHub issue or contact the development team.
