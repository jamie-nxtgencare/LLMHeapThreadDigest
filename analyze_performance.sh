#!/bin/bash

# analyze_performance.sh - Combined script for Java thread and heap dump analysis

# Set up defaults
THREAD_DUMP=""
HEAP_DUMP=""
OUTPUT_DIR="./analysis_results"
OUTPUT_PREFIX="java_performance_analysis"
MAT_PATH="/Applications/MemoryAnalyzer.app"

# Function to display usage information
usage() {
  echo "Usage: $0 <thread_dump_file> <heap_dump_file> [options]"
  echo ""
  echo "Options:"
  echo "  -o, --output-dir DIR      Output directory for analysis results (default: ./analysis_results)"
  echo "  -p, --prefix PREFIX       Prefix for output files (default: java_performance_analysis)"
  echo "  -m, --mat-path PATH       Path to Eclipse Memory Analyzer installation (default: /Applications/MemoryAnalyzer.app)"
  echo "  -h, --help                Show this help message"
  echo ""
  echo "Example:"
  echo "  $0 thread_dump.txt heap_dump.hprof --output-dir ./results"
  exit 1
}

# Parse command-line arguments
if [ $# -lt 2 ]; then
  usage
fi

THREAD_DUMP="$1"
HEAP_DUMP="$2"
shift 2

while [ $# -gt 0 ]; do
  case "$1" in
    -o|--output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -p|--prefix)
      OUTPUT_PREFIX="$2"
      shift 2
      ;;
    -m|--mat-path)
      MAT_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

# Check if input files exist
if [ ! -f "$THREAD_DUMP" ]; then
  echo "Error: Thread dump file not found: $THREAD_DUMP"
  exit 1
fi

if [ ! -f "$HEAP_DUMP" ]; then
  echo "Error: Heap dump file not found: $HEAP_DUMP"
  exit 1
fi

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Set output file paths
THREAD_ANALYSIS_FILE="$OUTPUT_DIR/${OUTPUT_PREFIX}_thread_analysis.json"
HEAP_ANALYSIS_FILE="$OUTPUT_DIR/${OUTPUT_PREFIX}_heap_analysis.json"
PERFORMANCE_ANALYSIS_FILE="$OUTPUT_DIR/${OUTPUT_PREFIX}_combined_analysis.json"

# Print analysis start message
echo "=========================================================="
echo "Java Performance Analysis"
echo "=========================================================="
echo "Thread Dump: $THREAD_DUMP"
echo "Heap Dump: $HEAP_DUMP"
echo "Output Directory: $OUTPUT_DIR"
echo "=========================================================="

# Step 1: Analyze thread dump
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Analyzing thread dump..."
node ./ThreadAnalyzer.js "$THREAD_DUMP" --output "$THREAD_ANALYSIS_FILE"
if [ $? -ne 0 ]; then
  echo "Error: Thread analysis failed."
  exit 1
fi
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Thread analysis complete. Results saved to $THREAD_ANALYSIS_FILE"

# Step 2: Analyze heap dump
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Analyzing heap dump..."
./run_heap_analysis.sh -h "$HEAP_DUMP" -r "suspects,overview,top_components" --output "$HEAP_ANALYSIS_FILE"
if [ $? -ne 0 ]; then
  echo "Error: Heap analysis failed."
  exit 1
fi
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Heap analysis complete. Results saved to $HEAP_ANALYSIS_FILE"

# Step 3: Combine the analyses
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Combining analyses..."
node ./JavaPerformanceAnalyzer.js --thread-analysis "$THREAD_ANALYSIS_FILE" --heap-analysis "$HEAP_ANALYSIS_FILE" --output "$PERFORMANCE_ANALYSIS_FILE"
if [ $? -ne 0 ]; then
  echo "Error: Combined analysis failed."
  exit 1
fi
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Combined analysis complete. Results saved to $PERFORMANCE_ANALYSIS_FILE"

# Print summary
echo "=========================================================="
echo "Analysis Complete!"
echo "=========================================================="
echo "Thread Analysis: $THREAD_ANALYSIS_FILE"
echo "Heap Analysis: $HEAP_ANALYSIS_FILE"
echo "Combined Analysis: $PERFORMANCE_ANALYSIS_FILE"
echo "=========================================================="

# Show top recommendations if available
if [ -f "$PERFORMANCE_ANALYSIS_FILE" ]; then
  echo "Top Recommendations:"
  grep -A 10 "topRecommendations" "$PERFORMANCE_ANALYSIS_FILE" | grep -v "topRecommendations" | grep -v "\[" | grep -v "\]" | sed 's/^[ \t]*//' | sed 's/,$//' | sed 's/^"//' | sed 's/"$//' | grep -v "^$" | head -3
  echo "=========================================================="
fi

exit 0