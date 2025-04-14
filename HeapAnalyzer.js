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

  // Helper function to find HTML files recursively
  findHtmlFiles(dir) {
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
    
    // First check if directory exists
    if (!fs.existsSync(dir)) {
      console.error(`[HeapAnalyzer] Report directory does not exist: ${dir}`);
      return htmlFiles;
    }
    
    searchRecursive(dir);
    console.log(`[HeapAnalyzer] Found ${htmlFiles.length} HTML files in ${dir}`);
    return htmlFiles;
  }

  // Process MAT HTML reports with more robust file searching
  processMatReports() {
    const analysis = {
      overview: {},
      suspects: [],
      topComponents: []
    };

    // Search for HTML files in each report subdirectory
    const reportTypes = ['overview', 'suspects', 'top_components'];
    
    for (const reportType of reportTypes) {
      const reportDir = path.join(this.reportDir, reportType);
      if (!fs.existsSync(reportDir)) {
        console.warn(`[HeapAnalyzer] Report directory does not exist: ${reportDir}`);
        continue;
      }
      
      console.log(`[HeapAnalyzer] Searching for ${reportType} report in ${reportDir}`);
      
      // Find all HTML files in this report directory
      const htmlFiles = this.findHtmlFiles(reportDir);
      if (htmlFiles.length === 0) {
        console.warn(`[HeapAnalyzer] No HTML files found in ${reportDir}`);
        continue;
      }
      
      // Look for the main index.html file first
      const indexFile = htmlFiles.find(file => path.basename(file) === 'index.html');
      let reportHtml = null;
      
      if (indexFile) {
        try {
          console.log(`[HeapAnalyzer] Found index.html for ${reportType} report at ${indexFile}`);
          reportHtml = fs.readFileSync(indexFile, 'utf-8');
        } catch (err) {
          console.warn(`[HeapAnalyzer] Could not read ${indexFile}: ${err.message}`);
        }
      }
      
      // If index.html didn't work, try other approaches based on report type
      if (!reportHtml) {
        if (reportType === 'suspects') {
          // For suspects, try to find specific leak suspect pages
          const suspectFiles = htmlFiles.filter(file => 
            path.basename(file).match(/^\d+\.html$/) || // Numbered HTML files like 18.html
            file.includes('Problem_Suspect')
          );
          
          if (suspectFiles.length > 0) {
            try {
              // Sort files to get the first suspect page
              suspectFiles.sort((a, b) => {
                const aNum = parseInt(path.basename(a).match(/^(\d+)\.html$/)?.at(1) || '9999');
                const bNum = parseInt(path.basename(b).match(/^(\d+)\.html$/)?.at(1) || '9999');
                return aNum - bNum;
              });
              
              console.log(`[HeapAnalyzer] Found suspect file: ${suspectFiles[0]}`);
              reportHtml = fs.readFileSync(suspectFiles[0], 'utf-8');
            } catch (err) {
              console.warn(`[HeapAnalyzer] Could not read suspect file: ${err.message}`);
            }
          }
        } else if (reportType === 'overview') {
          // For overview, try to find System_Overview HTML file
          const overviewFile = htmlFiles.find(file => file.includes('System_Overview'));
          if (overviewFile) {
            try {
              console.log(`[HeapAnalyzer] Found overview file: ${overviewFile}`);
              reportHtml = fs.readFileSync(overviewFile, 'utf-8');
            } catch (err) {
              console.warn(`[HeapAnalyzer] Could not read overview file: ${err.message}`);
            }
          }
        } else if (reportType === 'top_components') {
          // For top_components, try to find Top_Components HTML file
          const topComponentsFile = htmlFiles.find(file => 
            file.includes('Top_Components') || 
            file.includes('Top_Consumers')
          );
          
          if (topComponentsFile) {
            try {
              console.log(`[HeapAnalyzer] Found top components file: ${topComponentsFile}`);
              reportHtml = fs.readFileSync(topComponentsFile, 'utf-8');
            } catch (err) {
              console.warn(`[HeapAnalyzer] Could not read top components file: ${err.message}`);
            }
          }
        }
      }
      
      // Parse the report based on type
      if (reportHtml) {
        try {
          console.log(`[HeapAnalyzer] Parsing ${reportType} report`);
          switch (reportType) {
            case 'overview':
              analysis.overview = this.parseOverviewReport(reportHtml) || {};
              break;
            case 'suspects':
              analysis.suspects = this.parseSuspectsReport(reportHtml) || [];
              break;
            case 'top_components':
              analysis.topComponents = this.parseTopComponentsReport(reportHtml) || [];
              break;
          }
        } catch (err) {
          console.error(`[HeapAnalyzer] Error parsing ${reportType} report: ${err}`);
        }
      }
    }

    return analysis;
  }

  // Parse the MAT overview report
  parseOverviewReport(html) {
    console.log('[HeapAnalyzer] Parsing overview report');
    const $ = cheerio.load(html);
    const overview = {};
    
    // Attempt to extract key metrics from various possible HTML structures
    try {
      // Try to find system properties table
      const systemPropsTable = $('table').filter(function() {
        return $(this).find('th:contains("System Property")').length > 0;
      });
      
      systemPropsTable.find('tr').each(function() {
        const cells = $(this).find('td');
        if (cells.length >= 2) {
          const key = cells.eq(0).text().trim();
          const value = cells.eq(1).text().trim();
          if (key && value) {
            overview[key.replace(/\s+/g, '_').toLowerCase()] = value;
          }
        }
      });
      
      // Try to find heap info
      const heapSizeText = $('*:contains("Heap Size")').text();
      const heapSizeMatch = heapSizeText.match(/Heap Size:\s*([\d,]+)\s*(\w+)/i);
      if (heapSizeMatch) {
        overview.heap_size = `${heapSizeMatch[1]} ${heapSizeMatch[2]}`;
      }
      
      // Get total objects count - look for any mention of 'objects'
      const objectsText = $('*:contains("objects")').text();
      const objectsMatch = objectsText.match(/([\d,]+)\s*objects/i);
      if (objectsMatch) {
        overview.total_objects = objectsMatch[1];
      }
    } catch (err) {
      console.error('[HeapAnalyzer] Error parsing overview report:', err);
    }
    
    return overview;
  }

  parseSuspectsReport(html) {
    console.log('[HeapAnalyzer] Parsing suspects report');
    const $ = cheerio.load(html);
    const suspects = [];
    
    try {
      // Look for any table with suspect information
      // MAT typically structures leak suspects in tables
      $('table').each(function() {
        const firstRow = $(this).find('tr:first');
        if (firstRow.text().includes('Problem') || 
            firstRow.text().includes('Suspect') || 
            firstRow.text().includes('Leak')) {
          
          // This is likely a leak suspects table
          $(this).find('tr:not(:first)').each(function() {
            const columns = $(this).find('td');
            if (columns.length > 0) {
              const suspect = {
                details: columns.eq(0).text().trim(),
                size: ''
              };
              
              // Try to find a size column
              columns.each(function() {
                const text = $(this).text().trim();
                if (text.match(/\b\d+([.,]\d+)?\s*(KB|MB|GB|B)\b/i)) {
                  suspect.size = text;
                }
              });
              
              suspects.push(suspect);
            }
          });
        }
      });
      
      // If no structured table found, try to extract from text
      if (suspects.length === 0) {
        // Look for possible suspect descriptions
        const suspectBlocks = $('div.suspect, div.problem, div.leak, div.important');
        suspectBlocks.each(function() {
          suspects.push({
            details: $(this).text().trim(),
            size: ''
          });
        });
        
        // Also look for important sections that might contain leak information
        const importantSections = $('.important, .suspect, #exp18, #exp19');
        importantSections.each(function() {
          // Try to extract size information
          const text = $(this).text();
          const sizeMatch = text.match(/(\d+[\d,.]*)\s*(bytes|KB|MB|GB)/);
          const percentMatch = text.match(/(\d+[\d,.]*)\s*\%/);
          
          if (text.includes('Problem') || text.includes('Suspect') || text.includes('Leak')) {
            suspects.push({
              details: text.substring(0, 250) + '...', // Truncate very long descriptions
              size: sizeMatch ? sizeMatch[0] : (percentMatch ? percentMatch[0] : 'Unknown')
            });
          }
        });
      }
      
      console.log(`[HeapAnalyzer] Found ${suspects.length} suspects`);
    } catch (err) {
      console.error('[HeapAnalyzer] Error parsing suspects report:', err);
    }
    
    return suspects;
  }

  parseTopComponentsReport(html) {
    console.log('[HeapAnalyzer] Parsing top components report');
    const $ = cheerio.load(html);
    const components = [];
    
    try {
      // Look for tables that might contain component information
      $('table').each(function() {
        const headers = $(this).find('th');
        const headerText = headers.text().toLowerCase();
        
        // Look for tables with class/component/size info
        if (headerText.includes('class') || 
            headerText.includes('component') || 
            headerText.includes('size') || 
            headerText.includes('bytes')) {
          
          $(this).find('tr:not(:first)').each(function() {
            const columns = $(this).find('td');
            if (columns.length >= 2) {
              const component = {
                name: columns.eq(0).text().trim(),
                objectCount: columns.length >= 3 ? columns.eq(1).text().trim() : 'N/A',
                size: columns.length >= 3 ? columns.eq(2).text().trim() : columns.eq(1).text().trim()
              };
              
              components.push(component);
            }
          });
        }
      });
      
      console.log(`[HeapAnalyzer] Found ${components.length} top components`);
    } catch (err) {
      console.error('[HeapAnalyzer] Error parsing top components report:', err);
    }
    
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
      summary.totalObjects = analysis.overview?.total_objects || 'N/A';
      summary.totalSize = analysis.overview?.heap_size || 'N/A';

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