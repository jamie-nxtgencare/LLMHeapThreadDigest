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

# Split reports into array
IFS=',' read -r -a REPORT_TYPES <<< "$REPORTS"

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

# Process reports
REPORT_ZIP_FILES=()

# First, check if MAT has already generated report ZIP files
for report in "${REPORT_TYPES[@]}"; do
    REPORT_NAME=""
    case "$report" in
        suspects)
            REPORT_NAME="Leak_Suspects"
            ;;
        overview)
            REPORT_NAME="System_Overview"
            ;;
        top_components)
            REPORT_NAME="Top_Components"
            ;;
        components)
            REPORT_NAME="Top_Components"  # Also handle 'components' as alias for 'top_components'
            ;;
        *)
            log "Warning: Unknown report type '$report'"
            continue
            ;;
    esac
    
    # Look for the ZIP file
    HEAP_DUMP_BASENAME=$(basename "$HEAP_DUMP_FILE" .hprof)
    REPORT_ZIP_FILE="$(dirname "$HEAP_DUMP_FILE")/${HEAP_DUMP_BASENAME}_${REPORT_NAME}.zip"
    
    if [ -f "$REPORT_ZIP_FILE" ]; then
        log "Found existing report ZIP file: $REPORT_ZIP_FILE"
        REPORT_ZIP_FILES+=("$REPORT_ZIP_FILE")
    else
        log "Generating $report report..."
        "$MAT_EXECUTABLE" "$HEAP_DUMP_FILE" "org.eclipse.mat.api:$report" 2>&1
        
        # Check again for the zip file after generation attempt
        if [ -f "$REPORT_ZIP_FILE" ]; then
            log "Successfully generated report: $REPORT_ZIP_FILE"
            REPORT_ZIP_FILES+=("$REPORT_ZIP_FILE")
        else
            log "Failed to generate $report report"
        fi
    fi
done

# Extract report ZIP files to reports directory
if [ ${#REPORT_ZIP_FILES[@]} -gt 0 ]; then
    log "Found ${#REPORT_ZIP_FILES[@]} report ZIP files"
    
    for zip_file in "${REPORT_ZIP_FILES[@]}"; do
        # Get report type from zip filename
        ZIP_BASENAME=$(basename "$zip_file")
        REPORT_TYPE=""
        
        if [[ "$ZIP_BASENAME" == *"Leak_Suspects"* ]]; then
            REPORT_TYPE="suspects"
        elif [[ "$ZIP_BASENAME" == *"System_Overview"* ]]; then
            REPORT_TYPE="overview"
        elif [[ "$ZIP_BASENAME" == *"Top_Components"* ]]; then
            REPORT_TYPE="top_components"
        else
            # Extract report type from filename if possible
            REPORT_TYPE="$(echo "$ZIP_BASENAME" | sed 's/.*_\([^_]*\)\.zip/\1/' | tr '[:upper:]' '[:lower:]')"
        fi
        
        # Create a specific subdirectory for this report
        REPORT_SUBDIR="$REPORTS_DIR/$REPORT_TYPE"
        mkdir -p "$REPORT_SUBDIR"
        
        log "Copying and extracting $zip_file to $REPORT_SUBDIR"
        # Copy ZIP file to reports directory
        cp "$zip_file" "$REPORT_SUBDIR/"
        # Extract ZIP file in report-specific subdirectory
        unzip -o "$REPORT_SUBDIR/$(basename "$zip_file")" -d "$REPORT_SUBDIR" > /dev/null
    done
else
    log "No report ZIP files found or generated"
    exit 1
fi



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