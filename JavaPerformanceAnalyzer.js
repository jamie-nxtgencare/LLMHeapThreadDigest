#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

class JavaPerformanceAnalyzer {
  constructor(options = {}) {
    this.threadAnalysisFile = options.threadAnalysisFile;
    this.heapAnalysisFile = options.heapAnalysisFile;
    this.outputFile = options.outputFile || 'performance_analysis_result.json';
    
    console.log(`[JavaPerformanceAnalyzer] Thread analysis file: ${this.threadAnalysisFile}`);
    console.log(`[JavaPerformanceAnalyzer] Heap analysis file: ${this.heapAnalysisFile}`);
  }

  /**
   * Run the combined analysis
   * @returns {Object} Combined analysis results
   */
  analyze() {
    console.log('[JavaPerformanceAnalyzer] Starting combined analysis');
    
    // Load thread analysis results
    let threadAnalysis;
    try {
      const data = fs.readFileSync(this.threadAnalysisFile, 'utf8');
      threadAnalysis = JSON.parse(data);
      console.log('[JavaPerformanceAnalyzer] Loaded thread analysis results');
    } catch (error) {
      console.error(`[JavaPerformanceAnalyzer] Error loading thread analysis: ${error.message}`);
      threadAnalysis = { error: error.message };
    }
    
    // Load heap analysis results
    let heapAnalysis;
    try {
      const data = fs.readFileSync(this.heapAnalysisFile, 'utf8');
      heapAnalysis = JSON.parse(data);
      console.log('[JavaPerformanceAnalyzer] Loaded heap analysis results');
    } catch (error) {
      console.error(`[JavaPerformanceAnalyzer] Error loading heap analysis: ${error.message}`);
      heapAnalysis = { error: error.message };
    }
    
    // Perform correlation analysis
    const correlations = this.identifyCorrelations(threadAnalysis, heapAnalysis);
    console.log(`[JavaPerformanceAnalyzer] Found ${correlations.length} correlations`);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(threadAnalysis, heapAnalysis, correlations);
    
    // Create combined analysis
    const analysis = {
      summary: this.generateSummary(threadAnalysis, heapAnalysis, correlations, recommendations),
      threadAnalysis: threadAnalysis,
      heapAnalysis: heapAnalysis,
      correlations: correlations,
      recommendations: recommendations
    };
    
    return analysis;
  }

  /**
   * Identify correlations between thread and heap issues
   * @param {Object} threadAnalysis - Thread analysis results
   * @param {Object} heapAnalysis - Heap analysis results
   * @returns {Array} Array of correlation objects
   */
  identifyCorrelations(threadAnalysis, heapAnalysis) {
    const correlations = [];
    
    // Skip if either analysis has errors
    if (threadAnalysis.error || heapAnalysis.error) {
      return correlations;
    }
    
    // Check for leak suspects correlated with blocked threads
    if (heapAnalysis.suspects && heapAnalysis.suspects.length > 0 && 
        threadAnalysis.blockedThreads && threadAnalysis.blockedThreads.length > 0) {
      
      for (const suspect of heapAnalysis.suspects) {
        const suspectDetails = suspect.details.toLowerCase();
        
        // Look for thread names in leak suspects
        for (const blockedThread of threadAnalysis.blockedThreads) {
          const threadName = blockedThread.name.toLowerCase();
          
          // Check if the thread name appears in the leak details
          if (suspectDetails.includes(threadName)) {
            correlations.push({
              type: 'Leak Suspect and Blocked Thread',
              description: `Thread "${blockedThread.name}" is mentioned in leak suspect details and is also blocked`,
              threadInfo: blockedThread,
              heapInfo: suspect,
              severity: 'High'
            });
          }
          
          // Check for class names in both the leak details and thread stack
          if (blockedThread.stackTrace) {
            const stackClasses = this.extractClassNames(blockedThread.stackTrace);
            const leakClasses = this.extractClassNames([suspectDetails]);
            
            const commonClasses = stackClasses.filter(cls => leakClasses.includes(cls));
            if (commonClasses.length > 0) {
              correlations.push({
                type: 'Common Classes in Leak and Thread Stack',
                description: `Classes ${commonClasses.join(', ')} appear in both leak suspect and blocked thread stack`,
                commonClasses,
                threadInfo: blockedThread,
                heapInfo: suspect,
                severity: 'Medium'
              });
            }
          }
        }
      }
    }
    
    // Check for connection pool issues
    if (threadAnalysis.threadPools) {
      for (const poolName in threadAnalysis.threadPools) {
        const pool = threadAnalysis.threadPools[poolName];
        
        // Check for database connection pool saturation
        if ((poolName.includes('Connection') || poolName.includes('HikariCP') || poolName.includes('C3P0')) && 
            pool.utilization > 80 && pool.blockedThreads > 0) {
          
          // Look for related objects in heap
          const relatedLeaks = (heapAnalysis.suspects || []).filter(suspect => 
            suspect.details.toLowerCase().includes('connection') ||
            suspect.details.toLowerCase().includes('statement') ||
            suspect.details.toLowerCase().includes('resultset')
          );
          
          if (relatedLeaks.length > 0) {
            correlations.push({
              type: 'DB Connection Pool Issue',
              description: `Database connection pool ${poolName} has high utilization (${pool.utilization.toFixed(2)}%) and blocked threads, with related leak suspects`,
              threadInfo: pool,
              heapInfo: relatedLeaks,
              severity: 'High'
            });
          }
        }
      }
    }
    
    // Check for garbage collection impact
    const gcThreads = (threadAnalysis.threads || []).filter(thread => 
      thread.name && (
        thread.name.toLowerCase().includes('gc') || 
        thread.name.toLowerCase().includes('garbage collection')
      )
    );
    
    if (gcThreads.length > 0 && heapAnalysis.summary && heapAnalysis.summary.suspectCount > 0) {
      correlations.push({
        type: 'GC Pressure',
        description: 'Garbage collection threads found with memory leak suspects, suggesting GC pressure',
        gcThreads,
        leakCount: heapAnalysis.summary.suspectCount,
        severity: 'Medium'
      });
    }
    
    return correlations;
  }

  /**
   * Extract class names from an array of stack trace lines
   * @param {Array} stackTrace - Array of stack trace lines
   * @returns {Array} Array of class names
   */
  extractClassNames(stackTrace) {
    const classNames = new Set();
    
    for (const line of stackTrace) {
      // Extract class names from stack traces
      // Format: "at com.example.ClassName.methodName(FileName.java:123)"
      const match = line.match(/at\s+([a-zA-Z0-9_$.]+)\.([a-zA-Z0-9_$]+)\(/);
      if (match && match[1]) {
        const fullClassName = match[1];
        
        // Add the full class name
        classNames.add(fullClassName);
        
        // Also add the simple class name (without package)
        const simpleName = fullClassName.split('.').pop();
        if (simpleName && simpleName !== fullClassName) {
          classNames.add(simpleName);
        }
      }
    }
    
    return Array.from(classNames);
  }

  /**
   * Generate recommendations based on the combined analysis
   * @param {Object} threadAnalysis - Thread analysis results
   * @param {Object} heapAnalysis - Heap analysis results
   * @param {Array} correlations - Correlation analysis results
   * @returns {Array} Array of recommendation objects
   */
  generateRecommendations(threadAnalysis, heapAnalysis, correlations) {
    const recommendations = [];
    
    // Add recommendations from thread analysis if available
    if (threadAnalysis.recommendations && Array.isArray(threadAnalysis.recommendations)) {
      threadAnalysis.recommendations.forEach(rec => {
        recommendations.push({
          ...rec,
          source: 'Thread Analysis'
        });
      });
    }
    
    // Generate recommendations based on heap analysis
    if (heapAnalysis.suspects && heapAnalysis.suspects.length > 0) {
      recommendations.push({
        severity: 'High',
        issue: 'Memory leak suspects detected',
        description: `Found ${heapAnalysis.suspects.length} potential memory leak suspects in heap dump.`,
        solution: 'Review the suspect objects and check for issues like unclosed resources or circular references. Consider adding proper cleanup in finally blocks or using try-with-resources.',
        source: 'Heap Analysis'
      });
    }
    
    // Generate recommendations based on correlations
    for (const correlation of correlations) {
      if (correlation.type === 'Leak Suspect and Blocked Thread') {
        recommendations.push({
          severity: 'Critical',
          issue: 'Thread involved in both blocking and memory leak',
          description: `Thread "${correlation.threadInfo.name}" is both blocked and involved in memory leak suspect.`,
          solution: 'This thread is likely a critical issue source. Check resource handling and synchronization in this component.',
          source: 'Correlation Analysis'
        });
      } else if (correlation.type === 'DB Connection Pool Issue') {
        recommendations.push({
          severity: 'High',
          issue: 'Database connection pool issues',
          description: 'Connection pool has high utilization and is related to memory leak suspects.',
          solution: 'Check for unclosed connections, statements, or result sets. Ensure all DB resources are closed properly in finally blocks or try-with-resources. Consider increasing the connection pool size temporarily.',
          source: 'Correlation Analysis'
        });
      } else if (correlation.type === 'GC Pressure') {
        recommendations.push({
          severity: 'Medium',
          issue: 'Garbage collection pressure',
          description: 'Active garbage collection threads with memory leak suspects detected.',
          solution: 'The application may be creating too many temporary objects. Review object creation in hot code paths and consider implementing object pooling or reusing existing objects.',
          source: 'Correlation Analysis'
        });
      }
    }
    
    // Sort recommendations by severity
    const severityOrder = { 'Critical': 1, 'High': 2, 'Medium': 3, 'Low': 4 };
    recommendations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    
    return recommendations;
  }

  /**
   * Generate a summary of the combined analysis
   * @param {Object} threadAnalysis - Thread analysis results
   * @param {Object} heapAnalysis - Heap analysis results
   * @param {Array} correlations - Correlation analysis results
   * @param {Array} recommendations - Recommendation objects
   * @returns {Object} Summary object
   */
  generateSummary(threadAnalysis, heapAnalysis, correlations, recommendations) {
    // Determine health status based on critical issues
    let healthStatus = 'Healthy';
    let criticalIssues = 0;
    let highIssues = 0;
    let mediumIssues = 0;
    
    // Count issues by severity
    recommendations.forEach(rec => {
      if (rec.severity === 'Critical') criticalIssues++;
      if (rec.severity === 'High') highIssues++;
      if (rec.severity === 'Medium') mediumIssues++;
    });
    
    if (criticalIssues > 0) {
      healthStatus = 'Critical';
    } else if (highIssues > 0) {
      healthStatus = 'Poor';
    } else if (mediumIssues > 0) {
      healthStatus = 'Fair';
    }
    
    // Collect key metrics
    const threadMetrics = threadAnalysis.error ? {} : {
      totalThreads: threadAnalysis.summary?.totalThreads || 0,
      blockedThreads: threadAnalysis.summary?.blockedThreads || 0,
      deadlocks: threadAnalysis.summary?.deadlocks || 0,
      highCpuThreads: threadAnalysis.summary?.highCpuThreadCandidates || 0
    };
    
    const heapMetrics = heapAnalysis.error ? {} : {
      totalObjects: heapAnalysis.summary?.totalObjects || 'N/A',
      totalSize: heapAnalysis.summary?.totalSize || 'N/A',
      leakSuspects: heapAnalysis.summary?.suspectCount || 0
    };
    
    // Identify primary root causes
    const rootCauses = [];
    if (threadAnalysis.summary?.deadlocks > 0) {
      rootCauses.push('Deadlocks detected');
    }
    
    if (heapAnalysis.suspects && heapAnalysis.suspects.length > 0) {
      rootCauses.push('Memory leak suspects');
    }
    
    if (correlations.some(c => c.type === 'DB Connection Pool Issue')) {
      rootCauses.push('Database connection pool saturation');
    }
    
    if (correlations.some(c => c.type === 'GC Pressure')) {
      rootCauses.push('Garbage collection pressure');
    }
    
    if (threadAnalysis.summary?.blockedThreads > 0 && 
        threadAnalysis.summary?.blockedThreads / threadAnalysis.summary?.totalThreads > 0.2) {
      rootCauses.push('High thread contention');
    }
    
    if (threadMetrics.highCpuThreads > 0) {
      rootCauses.push('CPU-intensive threads detected');
    }
    
    // Create top recommendations
    const topRecommendations = recommendations
      .filter(rec => rec.severity === 'Critical' || rec.severity === 'High')
      .slice(0, 3)
      .map(rec => `${rec.issue}: ${rec.solution}`);
    
    return {
      healthStatus,
      analysisTimestamp: new Date().toISOString(),
      issueCount: {
        critical: criticalIssues,
        high: highIssues,
        medium: mediumIssues,
        total: criticalIssues + highIssues + mediumIssues
      },
      threadMetrics,
      heapMetrics,
      correlationCount: correlations.length,
      primaryRootCauses: rootCauses,
      topRecommendations
    };
  }

  /**
   * Save the analysis results to a file
   * @param {Object} analysis - The analysis results
   */
  saveResults(analysis) {
    try {
      fs.writeFileSync(this.outputFile, JSON.stringify(analysis, null, 2));
      console.log(`[JavaPerformanceAnalyzer] Results saved to ${this.outputFile}`);
    } catch (error) {
      console.error(`[JavaPerformanceAnalyzer] Error saving results: ${error.message}`);
      throw error;
    }
  }
}

// CLI script
function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const threadAnalysisOption = args.indexOf('--thread-analysis');
  const heapAnalysisOption = args.indexOf('--heap-analysis');
  const outputOption = args.indexOf('--output');
  
  // Check for required arguments
  if (threadAnalysisOption === -1 || heapAnalysisOption === -1) {
    console.error('Usage: node JavaPerformanceAnalyzer.js --thread-analysis <thread_analysis_file> --heap-analysis <heap_analysis_file> [--output <output_file>]');
    process.exit(1);
  }
  
  const threadAnalysisFile = args[threadAnalysisOption + 1];
  const heapAnalysisFile = args[heapAnalysisOption + 1];
  const outputFile = outputOption !== -1 ? args[outputOption + 1] : 'performance_analysis_result.json';
  
  // Verify input files exist
  if (!fs.existsSync(threadAnalysisFile)) {
    console.error(`Thread analysis file not found: ${threadAnalysisFile}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(heapAnalysisFile)) {
    console.error(`Heap analysis file not found: ${heapAnalysisFile}`);
    process.exit(1);
  }
  
  const analyzer = new JavaPerformanceAnalyzer({
    threadAnalysisFile,
    heapAnalysisFile,
    outputFile
  });
  
  try {
    const analysis = analyzer.analyze();
    analyzer.saveResults(analysis);
  } catch (error) {
    console.error(`Failed to analyze performance: ${error.message}`);
    process.exit(1);
  }
}

// Execute if this script is run directly
if (require.main === module) {
  main();
}

module.exports = JavaPerformanceAnalyzer;