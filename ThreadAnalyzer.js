#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

class ThreadAnalyzer {
  constructor(options = {}) {
    this.threadDumpFile = options.threadDumpFile;
    this.outputFile = options.outputFile || 'thread_analysis_result.json';
    console.log(`[ThreadAnalyzer] Thread dump file: ${this.threadDumpFile}`);
  }

  /**
   * Parse and analyze a thread dump file
   * @returns {Object} Analysis results
   */
  analyze() {
    console.log(`[ThreadAnalyzer] Analyzing thread dump: ${this.threadDumpFile}`);
    
    // Read the thread dump file
    let threadDump;
    try {
      threadDump = fs.readFileSync(this.threadDumpFile, 'utf8');
    } catch (error) {
      console.error(`[ThreadAnalyzer] Error reading thread dump file: ${error.message}`);
      throw error;
    }

    // Extract threads and their stack traces
    const threads = this.extractThreads(threadDump);
    console.log(`[ThreadAnalyzer] Found ${threads.length} threads`);

    // Calculate thread states distribution
    const stateDistribution = this.calculateStateDistribution(threads);
    
    // Find blocked threads
    const blockedThreads = this.findBlockedThreads(threads);
    console.log(`[ThreadAnalyzer] Found ${blockedThreads.length} blocked threads`);

    // Detect deadlocks
    const deadlocks = this.detectDeadlocks(threads);
    console.log(`[ThreadAnalyzer] Found ${deadlocks.length} deadlocks`);

    // Analyze thread pools
    const threadPools = this.analyzeThreadPools(threads);
    
    // Identify high CPU threads
    const highCpuThreads = this.identifyHighCpuThreads(threads);
    console.log(`[ThreadAnalyzer] Found ${highCpuThreads.length} high CPU thread candidates`);

    // Compile analysis
    const analysis = {
      summary: {
        totalThreads: threads.length,
        blockedThreads: blockedThreads.length,
        deadlocks: deadlocks.length,
        highCpuThreadCandidates: highCpuThreads.length
      },
      stateDistribution,
      blockedThreads,
      deadlocks,
      threadPools,
      highCpuThreads,
      recommendations: this.generateRecommendations({
        threads,
        blockedThreads,
        deadlocks,
        highCpuThreads,
        threadPools
      })
    };

    return analysis;
  }

  /**
   * Extract individual threads and their stack traces from the thread dump
   * @param {string} threadDump - The raw thread dump text
   * @returns {Array} Array of thread objects
   */
  extractThreads(threadDump) {
    const threads = [];
    
    // Split the thread dump into individual thread sections
    // This pattern varies by JVM vendor, but works for common formats
    const threadPattern = /"([^"]+)".+?((?:prio=\d+|RUNNABLE|BLOCKED|WAITING|TIMED_WAITING|NEW|TERMINATED).+?)(?:\n\n|\n"|\z)/gs;
    
    let match;
    while ((match = threadPattern.exec(threadDump)) !== null) {
      const threadText = match[0];
      const threadName = match[1];
      
      // Extract thread state (RUNNABLE, BLOCKED, etc.)
      const stateMatch = threadText.match(/(?:java\.lang\.Thread\.State:\s*(\w+)|state=(\w+))/);
      const state = stateMatch ? (stateMatch[1] || stateMatch[2]) : 'UNKNOWN';
      
      // Extract stack trace
      const stackLines = threadText
        .split('\n')
        .filter(line => line.trim().startsWith('at '))
        .map(line => line.trim());
      
      // Extract locks held and being waited on
      const locksHeld = [];
      const locksWaiting = [];
      
      // Locks held - "locked <0x...>"
      const lockedPattern = /locked\s+(<[^>]+>|[0-9a-fx]+)/g;
      let lockMatch;
      while ((lockMatch = lockedPattern.exec(threadText)) !== null) {
        locksHeld.push(lockMatch[1]);
      }
      
      // Locks waiting - "waiting on <0x...>" or "waiting to lock <0x...>"
      const waitingPattern = /waiting (?:on|to lock)\s+(<[^>]+>|[0-9a-fx]+)/g;
      while ((lockMatch = waitingPattern.exec(threadText)) !== null) {
        locksWaiting.push(lockMatch[1]);
      }
      
      // Extract daemon status
      const isDaemon = threadText.includes('daemon');
      
      // Extract thread ID
      const tidMatch = threadText.match(/tid=([0-9a-fx]+)/);
      const tid = tidMatch ? tidMatch[1] : null;
      
      // Extract native ID (nid)
      const nidMatch = threadText.match(/nid=([0-9a-fx]+)/);
      const nid = nidMatch ? nidMatch[1] : null;
      
      // Create thread object
      threads.push({
        name: threadName,
        state,
        stackTrace: stackLines,
        locksHeld,
        locksWaiting,
        isDaemon,
        tid,
        nid,
        raw: threadText
      });
    }
    
    return threads;
  }

  /**
   * Calculate the distribution of thread states
   * @param {Array} threads - Array of thread objects
   * @returns {Object} Distribution of thread states
   */
  calculateStateDistribution(threads) {
    const distribution = {};
    
    for (const thread of threads) {
      const state = thread.state;
      distribution[state] = (distribution[state] || 0) + 1;
    }
    
    return distribution;
  }

  /**
   * Find threads that are blocked waiting for locks
   * @param {Array} threads - Array of thread objects
   * @returns {Array} Array of blocked thread objects
   */
  findBlockedThreads(threads) {
    return threads.filter(thread => {
      return thread.state === 'BLOCKED' || 
             thread.locksWaiting.length > 0 ||
             thread.stackTrace.some(line => 
               line.includes('parking to wait for') ||
               line.includes('waiting on') ||
               line.includes('waiting to lock')
             );
    });
  }

  /**
   * Detect deadlocks in the thread dump
   * @param {Array} threads - Array of thread objects
   * @returns {Array} Array of deadlock objects
   */
  detectDeadlocks(threads) {
    const deadlocks = [];
    const lockOwners = new Map(); // Map of lock to owner thread

    // Build a map of which thread owns which lock
    for (const thread of threads) {
      for (const lock of thread.locksHeld) {
        lockOwners.set(lock, thread);
      }
    }

    // Find circular dependencies
    for (const thread of threads) {
      if (thread.locksWaiting.length === 0) continue;
      
      // Start with the first lock this thread is waiting on
      const visited = new Set();
      let currentThread = thread;
      let chainComplete = false;
      
      while (!chainComplete && currentThread.locksWaiting.length > 0) {
        // Mark this thread as visited
        visited.add(currentThread);
        
        // Find the owner of the lock this thread is waiting on
        const waitingOnLock = currentThread.locksWaiting[0];
        const lockOwner = lockOwners.get(waitingOnLock);
        
        if (!lockOwner) {
          // Lock owner not found in thread dump, can't continue
          chainComplete = true;
        } else if (visited.has(lockOwner)) {
          // Found a circular dependency - we have a deadlock
          deadlocks.push({
            threads: Array.from(visited).map(t => t.name),
            cycle: Array.from(visited).map(t => {
              const waitingOn = t.locksWaiting[0];
              const owner = lockOwners.get(waitingOn)?.name || 'unknown';
              return `${t.name} waiting on ${waitingOn} owned by ${owner}`;
            })
          });
          
          chainComplete = true;
        } else {
          // Continue following the chain
          currentThread = lockOwner;
        }
      }
    }
    
    return deadlocks;
  }

  /**
   * Analyze thread pools based on common naming patterns
   * @param {Array} threads - Array of thread objects
   * @returns {Object} Thread pool analysis results
   */
  analyzeThreadPools(threads) {
    const poolPatterns = [
      { pattern: /pool-(\d+)-thread-(\d+)/, name: 'Generic Thread Pool' },
      { pattern: /ForkJoinPool-(\d+)-worker-(\d+)/, name: 'ForkJoin Pool' },
      { pattern: /AsyncHttpClient-(\d+)-(\d+)/, name: 'Async HTTP Client' },
      { pattern: /Catalina-exec-(\d+)/, name: 'Tomcat Connector' },
      { pattern: /http-nio-(\d+)-exec-(\d+)/, name: 'Tomcat NIO HTTP' },
      { pattern: /C3P0PooledConnectionPoolManager/, name: 'C3P0 Connection Pool' },
      { pattern: /HikariPool-(\d+)/, name: 'HikariCP Connection Pool' },
      { pattern: /elasticsearch\[/, name: 'Elasticsearch' },
      { pattern: /kafka-/, name: 'Kafka' },
      { pattern: /RMI TCP Connection/, name: 'RMI' },
      { pattern: /Timer-(\d+)/, name: 'Timer' },
      { pattern: /JMX/, name: 'JMX' }
    ];
    
    const pools = {};
    
    // Categorize threads into pools
    for (const thread of threads) {
      let matched = false;
      for (const poolInfo of poolPatterns) {
        if (poolInfo.pattern.test(thread.name)) {
          const poolName = poolInfo.name;
          if (!pools[poolName]) {
            pools[poolName] = {
              totalThreads: 0,
              activeThreads: 0,
              blockedThreads: 0,
              waitingThreads: 0,
              threads: []
            };
          }
          
          pools[poolName].totalThreads++;
          
          if (thread.state === 'RUNNABLE') {
            pools[poolName].activeThreads++;
          } else if (thread.state === 'BLOCKED') {
            pools[poolName].blockedThreads++;
          } else if (['WAITING', 'TIMED_WAITING'].includes(thread.state)) {
            pools[poolName].waitingThreads++;
          }
          
          pools[poolName].threads.push({
            name: thread.name,
            state: thread.state
          });
          
          matched = true;
          break;
        }
      }
      
      // Catch any other thread pool patterns not explicitly defined
      if (!matched && thread.name.includes('thread')) {
        const poolName = 'Other Thread Pools';
        if (!pools[poolName]) {
          pools[poolName] = {
            totalThreads: 0,
            activeThreads: 0,
            blockedThreads: 0,
            waitingThreads: 0,
            threads: []
          };
        }
        
        pools[poolName].totalThreads++;
        
        if (thread.state === 'RUNNABLE') {
          pools[poolName].activeThreads++;
        } else if (thread.state === 'BLOCKED') {
          pools[poolName].blockedThreads++;
        } else if (['WAITING', 'TIMED_WAITING'].includes(thread.state)) {
          pools[poolName].waitingThreads++;
        }
        
        pools[poolName].threads.push({
          name: thread.name,
          state: thread.state
        });
      }
    }
    
    // Calculate utilization
    for (const poolName in pools) {
      const pool = pools[poolName];
      pool.utilization = (pool.activeThreads / pool.totalThreads) * 100;
      pool.blockage = (pool.blockedThreads / pool.totalThreads) * 100;
    }
    
    return pools;
  }

  /**
   * Identify threads that are likely consuming high CPU
   * @param {Array} threads - Array of thread objects
   * @returns {Array} Array of high CPU thread candidates
   */
  identifyHighCpuThreads(threads) {
    // Patterns that suggest CPU-intensive operations
    const cpuIntensivePatterns = [
      /compute/i,
      /calculate/i,
      /process/i,
      /sort[^A-Za-z]/i,
      /\.equals/,
      /\.hashCode/,
      /\.toString/,
      /jackson\.databind/,
      /regex/i,
      /Pattern\.match/,
      /DateFormat/,
      /SimpleDateFormat/,
      /fastjson/,
      /JSON\.parse/,
      /crypto/i,
      /Cipher/,
      /MessageDigest/,
      /serialize/i,
      /deserialize/i,
      /compres/i,
      /uncompress/i,
      /inflate/i,
      /deflate/i
    ];
    
    return threads
      .filter(thread => {
        // Must be in RUNNABLE state
        if (thread.state !== 'RUNNABLE') return false;
        
        // Check if the stack trace contains CPU-intensive patterns
        return thread.stackTrace.some(line => 
          cpuIntensivePatterns.some(pattern => pattern.test(line))
        );
      })
      .map(thread => ({
        name: thread.name,
        stackTrace: thread.stackTrace,
        reason: 'CPU-intensive patterns detected in stack trace'
      }));
  }

  /**
   * Generate recommendations based on the analysis
   * @param {Object} data - Analysis data including threads, blocked threads, etc.
   * @returns {Array} Array of recommendation objects
   */
  generateRecommendations(data) {
    const recommendations = [];

    // Check for deadlocks
    if (data.deadlocks.length > 0) {
      recommendations.push({
        severity: 'Critical',
        issue: 'Deadlocks detected',
        description: `Found ${data.deadlocks.length} deadlocks. These will cause affected threads to permanently hang.`,
        solution: 'Review lock ordering in the code. Consider using tryLock with timeout or java.util.concurrent utilities.'
      });
    }

    // Check for high number of blocked threads
    const blockedPercentage = (data.blockedThreads.length / data.threads.length) * 100;
    if (blockedPercentage > 20) {
      recommendations.push({
        severity: 'High',
        issue: 'High thread contention',
        description: `${data.blockedThreads.length} threads (${blockedPercentage.toFixed(2)}%) are blocked waiting for locks.`,
        solution: 'Review synchronization points. Consider finer-grained locking, lock-free algorithms, or concurrent collections.'
      });
    }

    // Check for thread pool saturation
    for (const poolName in data.threadPools) {
      const pool = data.threadPools[poolName];
      if (pool.utilization > 80 && pool.totalThreads > 5) {
        recommendations.push({
          severity: 'Medium',
          issue: `Thread pool saturation in ${poolName}`,
          description: `${pool.activeThreads} of ${pool.totalThreads} threads are active (${pool.utilization.toFixed(2)}% utilization).`,
          solution: 'Consider increasing the thread pool size or investigating why tasks are taking too long.'
        });
      }
      
      if (pool.blockage > 50 && pool.totalThreads > 5) {
        recommendations.push({
          severity: 'High',
          issue: `High blocking in ${poolName}`,
          description: `${pool.blockedThreads} of ${pool.totalThreads} threads are blocked (${pool.blockage.toFixed(2)}%).`,
          solution: 'Check for database or network operations inside synchronized blocks or locks.'
        });
      }
    }

    // Check for high CPU thread candidates
    if (data.highCpuThreads.length > 0) {
      recommendations.push({
        severity: 'Medium',
        issue: 'Potential CPU-intensive operations',
        description: `Found ${data.highCpuThreads.length} threads likely consuming high CPU.`,
        solution: 'Review these threads for computationally expensive operations. Consider caching, optimization, or moving work to background threads.'
      });
    }

    return recommendations;
  }

  /**
   * Save the analysis results to a file
   * @param {Object} analysis - The analysis results
   */
  saveResults(analysis) {
    try {
      fs.writeFileSync(this.outputFile, JSON.stringify(analysis, null, 2));
      console.log(`[ThreadAnalyzer] Results saved to ${this.outputFile}`);
    } catch (error) {
      console.error(`[ThreadAnalyzer] Error saving results: ${error.message}`);
      throw error;
    }
  }
}

// CLI script
function main() {
  const args = process.argv.slice(2);
  
  // Check for arguments
  if (args.length === 0) {
    console.error('Usage: node ThreadAnalyzer.js <thread_dump_file> [--output <output_file>]');
    process.exit(1);
  }
  
  const threadDumpFile = args[0];
  const outputIndex = args.indexOf('--output');
  const outputFile = outputIndex !== -1 && args[outputIndex + 1] 
    ? args[outputIndex + 1] 
    : 'thread_analysis_result.json';
  
  // Verify thread dump file exists
  if (!fs.existsSync(threadDumpFile)) {
    console.error(`Thread dump file not found: ${threadDumpFile}`);
    process.exit(1);
  }
  
  const analyzer = new ThreadAnalyzer({
    threadDumpFile,
    outputFile
  });
  
  try {
    const analysis = analyzer.analyze();
    analyzer.saveResults(analysis);
  } catch (error) {
    console.error(`Failed to analyze thread dump: ${error.message}`);
    process.exit(1);
  }
}

// Execute if this script is run directly
if (require.main === module) {
  main();
}

module.exports = ThreadAnalyzer;