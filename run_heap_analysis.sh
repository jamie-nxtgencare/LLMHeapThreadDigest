#!/bin/bash

# Heap Dump Analysis Script for Eclipse Memory Analyzer

# Set paths
HOME_DIR="$HOME"
PROJECT_DIR="$HOME_DIR/ai-workspace/LLMHeapThreadDigest"
MAT_APP="/Applications/MemoryAnalyzer.app"
MAT_EXECUTABLE="${MAT_APP}/Contents/Eclipse/ParseHeapDump.sh"
REPORTS_DIR="${PROJECT_DIR}/mat_reports"
HEAP_DUMP_FILE=""
REPORTS=""

# Logging function
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

# Error handling function
error_exit() {
    log "ERROR: $1"
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--heap-dump)
            HEAP_DUMP_FILE="$2"
            shift 2
            ;;
        -r|--reports)
            REPORTS="$2"
            shift 2
            ;;
        *)
            error_exit "Unknown option: $1"
            ;;
    esac
done

# Validate required arguments
if [ -z "$HEAP_DUMP_FILE" ]; then
    error_exit "Heap dump file is required. Use -h or --heap-dump to specify."
fi

# Default reports if not specified
REPORTS="${REPORTS:-suspects,overview,top_components}"

# Convert to absolute path
HEAP_DUMP_FILE="$(cd "$(dirname "$HEAP_DUMP_FILE")" && pwd)/$(basename "$HEAP_DUMP_FILE")"

# Validate heap dump file
if [ ! -f "$HEAP_DUMP_FILE" ]; then
    error_exit "Heap dump file not found: $HEAP_DUMP_FILE"
fi

# Create reports directory
mkdir -p "$REPORTS_DIR"

# Clean previous reports
rm -rf "$REPORTS_DIR"/*

# Log start of analysis
log "Starting Heap Dump Analysis"
log "Heap Dump File: $HEAP_DUMP_FILE"
log "Reports Directory: $REPORTS_DIR"
log "Requested Reports: $REPORTS"

# Attempt to generate reports
# Check for existing report ZIP files
REPORT_ZIP_FILES=()
for report in "${REPORT_TYPES[@]}"; do
    REPORT_ZIP_FILE="${HEAP_DUMP_FILE%.*}_${report}.zip"
    if [ -f "$REPORT_ZIP_FILE" ]; then
        log "Found existing report ZIP file: $REPORT_ZIP_FILE"
        REPORT_ZIP_FILES+=("$REPORT_ZIP_FILE")
    else
        log "Generating $report report..."
        "$MAT_EXECUTABLE" "$HEAP_DUMP_FILE" "org.eclipse.mat.api:$report" 2>&1
        REPORT_ZIP_FILE="${HEAP_DUMP_FILE%.*}_${report}.zip"
        if [ -f "$REPORT_ZIP_FILE" ]; then
            REPORT_ZIP_FILES+=("$REPORT_ZIP_FILE")
        else
            log "Failed to generate $report report"
        fi
    fi
done

# Extract report ZIP files
for zip_file in "${REPORT_ZIP_FILES[@]}"; do
    log "Extracting $zip_file..."
    unzip -o "$zip_file" -d "$REPORTS_DIR" > /dev/null
done
for report in "${REPORT_TYPES[@]}"; do
    log "Generating $report report..."
    case "$report" in
        suspects)
            "$MAT_EXECUTABLE" -application org.eclipse.mat.api.parse \
                -nosplash \
                -data "$REPORTS_DIR" \
                "$HEAP_DUMP_FILE" \
                suspects 2>&1
            ;;
        overview)
            "$MAT_EXECUTABLE" -application org.eclipse.mat.api.parse \
                -nosplash \
                -data "$REPORTS_DIR" \
                "$HEAP_DUMP_FILE" \
                overview 2>&1
            ;;
        top_components)
            "$MAT_EXECUTABLE" -application org.eclipse.mat.api.parse \
                -nosplash \
                -data "$REPORTS_DIR" \
                "$HEAP_DUMP_FILE" \
                top_components 2>&1
            ;;
        *)
            log "Warning: Unknown report type '$report'"
            ;;
    esac
done



# Run HeapAnalyzer.js to process the reports
log "Processing MAT reports with HeapAnalyzer.js..."
node "${PROJECT_DIR}/HeapAnalyzer.js" "$HEAP_DUMP_FILE" \
    --report-dir "$REPORTS_DIR" \
    --output "${PROJECT_DIR}/heap_analysis_result.json"

# Check HeapAnalyzer exit status
HEAP_ANALYZER_EXIT_STATUS=$?
if [ $HEAP_ANALYZER_EXIT_STATUS -ne 0 ]; then
    error_exit "HeapAnalyzer.js failed with exit status $HEAP_ANALYZER_EXIT_STATUS"
fi

log "Heap analysis complete. Results saved to ${PROJECT_DIR}/heap_analysis_result.json"

exit 0