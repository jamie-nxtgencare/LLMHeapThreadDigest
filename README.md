# Java Performance Analyzer

A set of tools for analyzing Java thread dumps and heap dumps to diagnose performance issues.

## Overview

This toolkit provides a comprehensive approach to analyzing Java performance issues by examining thread dumps and heap dumps. It includes:

1. **ThreadAnalyzer.js** - Analyzes thread dumps to find blocked threads, deadlocks, thread pool issues
2. **HeapAnalyzer.js** - Interfaces with Eclipse MAT to analyze heap dumps
3. **extract_mat_report.js** - Extracts information from MAT HTML reports 
4. **JavaPerformanceAnalyzer.js** - Combines both analyses to identify correlations between thread and memory issues

## Requirements

- Node.js (v12 or later)
- Eclipse Memory Analyzer Tool (MAT) for heap dump analysis
  - Download from: https://www.eclipse.org/mat/downloads.php
- Required npm packages (install with `npm install`):
  - xml2js (for parsing XML reports)
  - cheerio (for processing HTML reports from MAT)

## Getting Started

### Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Make all scripts executable:
   ```bash
   chmod +x *.sh *.js
   ```

### Analyzing Thread Dumps

Thread dumps are text files generated using `jstack` or through your JVM's management tools.

```bash
# Basic usage
./ThreadAnalyzer.js your-thread-dump.txt

# Save output to a file
./ThreadAnalyzer.js your-thread-dump.txt --output output.json
```

### Analyzing Heap Dumps

Heap dumps are binary files in HPROF format generated using `jmap` or through your JVM management tools.

#### Using the run_heap_analysis.sh script

This script automates the entire heap analysis process using Eclipse MAT:

1. Update the script with your paths if needed
2. Run the script with your heap dump:

```bash
./run_heap_analysis.sh
```

The script will:
- Parse the heap dump with Eclipse MAT
- Generate HTML reports
- Extract key information using extract_mat_report.js
- Save the analysis as JSON

#### Manual Process

You can also run the analysis steps manually:

```bash
# 1. Analyze heap dump with MAT to generate reports
/path/to/MemoryAnalyzer -application org.eclipse.mat.api.parse your-heap-dump.hprof org.eclipse.mat.api:suspects org.eclipse.mat.api:overview org.eclipse.mat.api:top_components

# 2. Extract information from MAT reports
./extract_mat_report.js /path/to/mat/reports --output heap-analysis.json
```

### Combined Analysis

For a comprehensive analysis, run both thread and heap dump analysis:

```bash
# Using the analyze_performance.sh script
./analyze_performance.sh your-thread-dump.txt your-heap-dump.hprof

# Or manually combine previous analyses
./JavaPerformanceAnalyzer.js --thread-analysis thread-analysis.json --heap-analysis heap-analysis.json --output performance-analysis.json
```

## Understanding the Output

The analysis produces a detailed report with these sections:

1. **Summary**
   - Overall health assessment
   - Key metrics
   - Critical issues
   - Root causes
   - Top recommendations

2. **Thread Analysis**
   - Thread state distribution
   - Blocked thread analysis
   - Thread pool utilization
   - High CPU thread detection
   - Deadlock detection

3. **Heap Analysis**
   - Memory leak suspects
   - Large objects
   - Class histogram
   - System properties

4. **Correlation Analysis**
   - Relationships between thread and memory issues
   - Root cause analysis
   - Actionable recommendations

## Diagnosing Common Issues

### Thread Contention

Look for:
- High number of blocked threads
- Long blocking chains
- Thread pools with high utilization
- Deadlocks

### Memory Leaks

Look for:
- Memory leak suspects identified by MAT
- Growing collections in the heap
- Large objects with unexpected sizes
- High number of instances of specific classes

### High CPU Usage

Look for:
- Threads identified as high CPU candidates
- CPU-intensive operations (regex, serialization, sorting)
- Thread pool saturation

### Slow Response Times

Look for:
- Combination of thread blocking and memory issues
- Thread pool saturation
- Long garbage collection pauses (inferred from thread analysis)

## Troubleshooting

### Common MAT Issues

1. **Out of Memory**: 
   - Increase MAT's memory in MemoryAnalyzer.ini
   - Use `-vmargs -Xmx8g` flag

2. **Parse Error**:
   - Try opening the heap dump in MAT GUI first
   - Check that the heap dump is in valid HPROF format

3. **Path Issues**:
   - MAT may have issues with paths containing spaces or special characters
   - Use absolute paths to avoid problems with ~ (home directory) expansion

### Thread Dump Issues

1. **No Threads Found**:
   - Verify the thread dump format is standard
   - Try generating a new thread dump with `jstack -l <pid>`

2. **Incorrect Thread States**:
   - Some JVM implementations may use slightly different thread state labeling
