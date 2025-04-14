#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const HeapAnalyzer = require('./HeapAnalyzer');

/**
 * A wrapper around HeapAnalyzer to extract information from MAT HTML reports
 */
class MATReportExtractor {
  constructor(options = {}) {
    this.reportDir = options.reportDir;
    this.outputFile = options.outputFile || 'mat_report_extract.json';
    
    console.log(`[MATReportExtractor] Report directory: ${this.reportDir}`);
  }
  
  /**
   * Extract information from MAT reports
   * @returns {Object} Extracted information
   */
  extract() {
    console.log(`[MATReportExtractor] Extracting information from MAT reports in ${this.reportDir}`);
    
    // Create a HeapAnalyzer instance
    const heapAnalyzer = new HeapAnalyzer({
      reportDir: this.reportDir
    });
    
    // Process the reports
    const analysis = heapAnalyzer.processMatReports();
    
    // Add summary data
    analysis.summary = heapAnalyzer.generateSummary(analysis);
    
    console.log('[MATReportExtractor] Extraction complete');
    
    return analysis;
  }
  
  /**
   * Save the extraction results to a file
   * @param {Object} results - The extraction results
   */
  saveResults(results) {
    try {
      fs.writeFileSync(this.outputFile, JSON.stringify(results, null, 2));
      console.log(`[MATReportExtractor] Results saved to ${this.outputFile}`);
    } catch (error) {
      console.error(`[MATReportExtractor] Error saving results: ${error.message}`);
      throw error;
    }
  }
}

// CLI script
function main() {
  const args = process.argv.slice(2);
  
  // Check for arguments
  if (args.length === 0) {
    console.error('Usage: node extract_mat_report.js <report_directory> [--output <output_file>]');
    process.exit(1);
  }
  
  const reportDir = args[0];
  const outputIndex = args.indexOf('--output');
  const outputFile = outputIndex !== -1 && args[outputIndex + 1] 
    ? args[outputIndex + 1] 
    : 'mat_report_extract.json';
  
  // Verify report directory exists
  if (!fs.existsSync(reportDir)) {
    console.error(`Report directory not found: ${reportDir}`);
    process.exit(1);
  }
  
  const extractor = new MATReportExtractor({
    reportDir,
    outputFile
  });
  
  try {
    const results = extractor.extract();
    extractor.saveResults(results);
  } catch (error) {
    console.error(`Failed to extract MAT report data: ${error.message}`);
    process.exit(1);
  }
}

// Execute if this script is run directly
if (require.main === module) {
  main();
}

module.exports = MATReportExtractor;