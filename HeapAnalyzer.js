#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cheerio = require('cheerio');

class HeapAnalyzer {
  constructor(options = {}) {
    this.matPath = options.matPath || process.env.MAT_PATH || this.findMatPath();
    this.reportDir = options.reportDir || path.join(process.cwd(), 'mat_reports');
    console.log(`[HeapAnalyzer] Using MAT executable: ${this.matPath}`);
    console.log(`[HeapAnalyzer] Report directory: ${this.reportDir}`);
  }

  findMatPath() {
    const defaultPaths = [
      '/Applications/MemoryAnalyzer.app/Contents/MacOS/MemoryAnalyzer',
      '/opt/MemoryAnalyzer/MemoryAnalyzer',
      '/usr/local/bin/MemoryAnalyzer'
    ];

    for (const path of defaultPaths) {
      try {
        fs.accessSync(path, fs.constants.X_OK);
        return path;
      } catch (err) {
        console.log(`[HeapAnalyzer] MAT not found at ${path}`);
      }
    }

    throw new Error('Could not find Memory Analyzer executable');
  }

  // Process MAT HTML reports with more robust file searching
  processMatReports() {
    const analysis = {
      overview: {},
      suspects: [],
      topComponents: []
    };

    // Helper function to find HTML files recursively
    const findHtmlFiles = (dir) => {
      const htmlFiles = [];
      
      const searchRecursive = (currentPath) => {
        try {
          const files = fs.readdirSync(currentPath);
          
          files.forEach(file => {
            const fullPath = path.join(currentPath, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
              searchRecursive(fullPath);
            } else if (file.endsWith('.html')) {
              htmlFiles.push(fullPath);
            }
          });
        } catch (err) {
          console.error(`[HeapAnalyzer] Error searching directory ${currentPath}: ${err.message}`);
        }
      };
      
      searchRecursive(dir);
      return htmlFiles;
    };

    // Find all HTML report files
    const htmlFiles = findHtmlFiles(this.reportDir);
    console.log('[HeapAnalyzer] Found HTML report files:', htmlFiles);

    // Helper function to safely read HTML file
    const safeReadHtml = (filePattern) => {
      const matchingFiles = htmlFiles.filter(file => 
        file.toLowerCase().includes(filePattern.toLowerCase())
      );
      
      if (matchingFiles.length > 0) {
        try {
          return fs.readFileSync(matchingFiles[0], 'utf-8');
        } catch (err) {
          console.warn(`[HeapAnalyzer] Could not read ${filePattern} report:`, err.message);
        }
      } else {
        console.warn(`[HeapAnalyzer] No matching file found for pattern: ${filePattern}`);
      }
      
      return null;
    };

    // Parsing methods with enhanced error handling
    const parseReport = (html, parserFn, reportType) => {
      if (!html) {
        console.warn(`[HeapAnalyzer] No HTML content for ${reportType} report`);
        return null;
      }
      
      try {
        return parserFn(html);
      } catch (err) {
        console.error(`[HeapAnalyzer] Error parsing ${reportType} report:`, err);
        return null;
      }
    };

    // Parse Overview Report
    const overviewHtml = safeReadHtml('overview');
    analysis.overview = parseReport(overviewHtml, this.parseOverviewReport.bind(this), 'overview') || {};

    // Parse Suspects Report
    const suspectsHtml = safeReadHtml('suspects');
    analysis.suspects = parseReport(suspectsHtml, this.parseSuspectsReport.bind(this), 'suspects') || [];

    // Parse Top Components Report
    const topComponentsHtml = safeReadHtml('top_components');
    analysis.topComponents = parseReport(topComponentsHtml, this.parseTopComponentsReport.bind(this), 'top_components') || [];

    return analysis;
  }

  // Placeholder methods for parsing - implement these based on your MAT report HTML structure
  parseOverviewReport(html) {
    const $ = cheerio.load(html);
    return {
      totalObjects: $('div.overview-summary').text().trim() || 'N/A'
    };
  }

  parseSuspectsReport(html) {
    const $ = cheerio.load(html);
    const suspects = [];
    
    $('table.suspects tr').each((i, row) => {
      if (i === 0) return; // Skip header row
      
      const columns = $(row).find('td');
      if (columns.length > 0) {
        suspects.push({
          details: columns.eq(0).text().trim(),
          size: columns.eq(1).text().trim()
        });
      }
    });
    
    return suspects;
  }

  parseTopComponentsReport(html) {
    const $ = cheerio.load(html);
    const components = [];
    
    $('table.top-components tr').each((i, row) => {
      if (i === 0) return; // Skip header row
      
      const columns = $(row).find('td');
      if (columns.length > 0) {
        components.push({
          name: columns.eq(0).text().trim(),
          objectCount: columns.eq(1).text().trim(),
          size: columns.eq(2).text().trim()
        });
      }
    });
    
    return components;
  }

  // Main analysis method
  async analyzeHeapDump(heapDumpFile) {
    try {
      // Ensure report directory exists
      if (!fs.existsSync(this.reportDir)) {
        fs.mkdirSync(this.reportDir, { recursive: true });
      }

      console.log(`[HeapAnalyzer] Analyzing heap dump: ${heapDumpFile}`);

      // Process the reports
      const analysis = this.processMatReports();

      // Add summary insights
      analysis.summary = this.generateSummary(analysis);

      return analysis;
    } catch (error) {
      console.error(`[HeapAnalyzer] Heap dump analysis error: ${error.message}`);
      throw error;
    }
  }

  // Generate summary with more defensive coding
  generateSummary(analysis) {
    const summary = {
      totalObjects: 'N/A',
      totalSize: 'N/A',
      suspectCount: 0,
      largestComponents: []
    };

    try {
      // Parse overview data
      summary.totalObjects = analysis.overview?.totalObjects || 'N/A';

      // Analyze suspects
      summary.suspectCount = analysis.suspects?.length || 0;

      // Analyze top components
      if (analysis.topComponents && analysis.topComponents.length > 0) {
        summary.largestComponents = analysis.topComponents
          .slice(0, 5)  // Top 5 largest components
          .map(component => ({
            name: component.name,
            objectCount: component.objectCount,
            size: component.size
          }));
      }
    } catch (err) {
      console.warn(`[HeapAnalyzer] Error generating summary: ${err.message}`);
    }

    return summary;
  }
}

// CLI script
function main() {
  const args = process.argv.slice(2);
  const heapDumpFile = args[0];
  const reportDirIndex = args.indexOf('--report-dir');
  const outputIndex = args.indexOf('--output');

  if (!heapDumpFile) {
    console.error('Usage: node HeapAnalyzer.js <heap_dump_file> [--report-dir <dir>] [--output <output_file>]');
    process.exit(1);
  }

  const options = {};
  if (reportDirIndex !== -1 && args[reportDirIndex + 1]) {
    options.reportDir = args[reportDirIndex + 1];
  }

  const analyzer = new HeapAnalyzer(options);

  analyzer.analyzeHeapDump(heapDumpFile)
    .then(analysis => {
      const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : 'heap_analysis_result.json';
      fs.writeFileSync(outputFile, JSON.stringify(analysis, null, 2));
      console.log(`[HeapAnalyzer] Analysis complete. Results written to ${outputFile}`);
    })
    .catch(error => {
      console.error('[HeapAnalyzer] Analysis failed:', error);
      process.exit(1);
    });
}

if (require.main === module) {
  main();
}

module.exports = HeapAnalyzer;