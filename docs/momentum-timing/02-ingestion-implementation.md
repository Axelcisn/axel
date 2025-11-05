# Momentum Timing — 02. Ingestion & Canonical Dataset Implementation

## Overview
Complete implementation of the upload → parse Excel → canonicalize → validate → persist → badges pipeline as specified in Step 2.

## Implementation Status: ✅ COMPLETE

### Files Created

#### 1. Core Types & Data Contracts
- **`/lib/types/canonical.ts`** - All data interfaces (CanonicalRow, CanonicalTableMeta, ValidationBadges, RepairRecord, IngestionResult)

#### 2. Calendar & TZ Service
- **`/lib/calendar/service.ts`** - Exchange resolution and trading day calculation (weekday approximation)

#### 3. Excel Processing
- **`/lib/ingestion/excel.ts`** - Excel parsing with column mapping and data validation

#### 4. Validation Engine
- **`/lib/validation/rules.ts`** - OHLC coherence, log returns computation, sorting & deduplication
- **`/lib/validation/badges.ts`** - Six-badge validation system

#### 5. Storage Layer
- **`/lib/storage/fsStore.ts`** - Atomic file operations for raw, canonical, and audit data

#### 6. Orchestration Pipeline
- **`/lib/ingestion/pipeline.ts`** - Complete ingestion workflow coordination

#### 7. API Endpoint
- **`/app/api/upload/route.ts`** - Multipart form handling and pipeline invocation

#### 8. User Interface
- **`/app/company/[ticker]/timing/page.tsx`** - Upload form and data quality dashboard

### Key Features Implemented

#### ✅ Data Processing
- Excel file parsing with flexible column mapping
- OHLC coherence validation: `high ≥ max(open, close), low ≤ min(open, close), low ≤ high`
- Log returns computation: `r_t = ln(adj_close_t / adj_close_{t−1})`
- Automatic adj_close filling from close when missing
- Date sorting and deduplication

#### ✅ Validation Badges System
1. **Contract OK** - Required columns present
2. **Calendar OK** - No missing trading days (weekday approximation)
3. **TZ OK** - IANA timezone resolved
4. **Corporate Actions OK** - Corporate action columns detected
5. **Validations OK** - All rows pass OHLC coherence
6. **Repairs Count** - Total number of data issues/fixes

#### ✅ Storage & Persistence
- Atomic file writes (temp → rename pattern)
- Three-tier storage: `/data/uploads/`, `/data/canonical/`, `/data/audit/`
- Complete audit trail of all repairs and modifications

#### ✅ Calendar Integration
- Exchange-to-timezone mapping (NASDAQ/NYSE → America/New_York)
- Missing trading day detection using weekday approximation
- Ready for holiday calendar integration (marked with TODOs)

### Technical Specifications Met

#### ✅ API Contract
```typescript
POST /api/upload
Content-Type: multipart/form-data
Fields: file (required), symbol (optional), exchange (optional)
Response: IngestionResult with paths, counts, meta, badges
```

#### ✅ File Paths Generated
- Raw: `/data/uploads/{ISO}-{symbol}.xlsx`
- Canonical: `/data/canonical/{symbol}.json`
- Audit: `/data/audit/repairs-{symbol}.json`

#### ✅ Data Quality Formulas
- **Log returns**: `r_t = ln(adj_close_t / adj_close_{t−1})`
- **OHLC coherence**: `high ≥ max(open, close), low ≤ min(open, close), low ≤ high`
- **Calendar check**: No gaps vs exchange calendar (weekday approximation)
- **Delistings**: Keep history; mark delisted=true if applicable

### Dependencies Added
- **xlsx@^0.18.5** - Excel file parsing

### Acceptance Criteria: ✅ COMPLETE

✅ Files created at exact specified paths  
✅ API accepts multipart/form-data with optional symbol/exchange  
✅ Pipeline resolves exchange/timezone, parses/maps columns, sorts/dedups, computes returns  
✅ OHLC coherence enforced with issue tracking  
✅ Missing trading days detected (weekday approximation)  
✅ All data persisted with atomic writes  
✅ Six badges computed and displayed  
✅ Data Quality card with details drawer  
✅ Methods/formulas tooltip included  
✅ NO changepoint detectors added (events will come from PIs only)  

### Next Steps
Ready for **Step 3: GBM Baseline** implementation.

### Usage Example
1. Navigate to `/company/AMD/timing`
2. Upload `AMD-history.xlsx` 
3. View badges and data quality metrics
4. Check generated files in `/data/` directories

### Development Server
Running on http://localhost:3001 (port 3000 in use)