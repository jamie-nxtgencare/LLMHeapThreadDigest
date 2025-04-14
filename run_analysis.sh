#!/bin/bash

# Set paths
HOME_DIR="$HOME"
DATA_DIR="$HOME_DIR/ai-workspace/tmp/barclay_problem"
THREAD_DUMP="$DATA_DIR/threaddump.txt"
THREAD_ANALYSIS="$DATA_DIR/thread_analysis.json"
HEAP_DUMP="$DATA_DIR/heapdump.hprof"
HEAP_ANALYSIS="$DATA_DIR/heap_analysis.json"
PERFORMANCE_ANALYSIS="$DATA_DIR/performance_analysis.json"

# Create data directory if it doesn't exist
mkdir -p "$DATA_DIR"

# Run thread analysis
echo "Starting thread dump analysis..."
./ThreadAnalyzer.js "$THREAD_DUMP" "$THREAD_ANALYSIS"

# Check if thread analysis was successful
if [ $? -ne 0 ]; then
  echo "Thread analysis failed"
  exit 1
fi

# Run heap analysis
echo "Running heap dump analysis..."
./run_heap_analysis.sh

# Check if heap analysis was successful
if [ ! -f "$HEAP_ANALYSIS" ]; then
  echo "Heap analysis failed to generate output"
  exit 1
fi

# Run combined performance analysis
echo "Running combined performance analysis..."
./JavaPerformanceAnalyzer.js "$THREAD_DUMP" "$HEAP_DUMP" --output "$PERFORMANCE_ANALYSIS"

# Check if combined analysis was successful
if [ $? -ne 0 ]; then
  echo "Combined performance analysis failed"
  exit 1
fi

echo "Performance analysis completed successfully"
